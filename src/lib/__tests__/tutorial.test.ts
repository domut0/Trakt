import { describe, expect, it } from "vitest";
import {
  TUTORIAL_STEPS,
  chaptersOf,
  isSandboxed,
  resumePoint,
  stepsFor,
  type TutorialSeen,
} from "../tutorial";

/** Nothing has happened yet. Every predicate should be false against this. */
const NOTHING: TutorialSeen = {
  installHandled: false,
  sheetConnected: false,
  sharedWithCoach: false,
  bodyweightLogged: false,
  startSheetOpen: false,
  activeSessionId: undefined,
  exerciseScreenOpen: false,
  currentExerciseId: undefined,
  sets: [],
  editingRow: undefined,
  summaryShown: false,
  chooserOpen: false,
  cardioPickerOpen: false,
  cardioFormOpen: false,
  cardioDurationTyped: false,
  cardioLogged: false,
};

const set = (id: string) => ({
  id,
  sessionId: "tut",
  exerciseId: "tut_bench",
  weight: 135,
  reps: 8,
  loggedAt: Number(id),
});

const stepById = (id: string) => {
  const step = TUTORIAL_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

describe("the steps", () => {
  it("has a unique id for every step", () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs its chapters in one order and never returns to one", () => {
    const order = TUTORIAL_STEPS.map((s) => s.chapter);
    const firstSeen = chaptersOf(TUTORIAL_STEPS);
    // A chapter appearing again after another has begun would make "resume at
    // the chapter you left" ambiguous.
    expect(order).toEqual(firstSeen.flatMap((c) => order.filter((o) => o === c)));
  });

  it("is complete only after the last thing it asks for", () => {
    // The guard on the whole design: nothing may be satisfied by an empty app.
    for (const step of TUTORIAL_STEPS) {
      // "Tap Done" on the summary is the one step whose done-state is an
      // ABSENCE, and it is only ever evaluated while the summary is up.
      if (step.id === "summary-done") continue;
      expect(step.done(NOTHING), step.id).toBe(false);
    }
  });

  it("offers a way past exactly the steps that depend on Google", () => {
    const skippable = TUTORIAL_STEPS.filter((s) => s.skippable).map((s) => s.id);
    expect(skippable).toEqual(["install", "connect-sheet", "share-sheet"]);
  });

  it("sandboxes the workout and the cardio, and nothing before them", () => {
    expect(isSandboxed("sheet")).toBe(false);
    expect(isSandboxed("share")).toBe(false);
    // The bodyweight they type is a real bodyweight.
    expect(isSandboxed("weight")).toBe(false);
    expect(isSandboxed("workout")).toBe(true);
    expect(isSandboxed("finish")).toBe(true);
    expect(isSandboxed("cardio")).toBe(true);
  });
});

describe("what each step waits for", () => {
  it("the sheet step waits for a connected sheet", () => {
    expect(stepById("connect-sheet").done({ ...NOTHING, sheetConnected: true })).toBe(true);
  });

  it("the bodyweight step waits for today's number, not for any number", () => {
    expect(stepById("log-bodyweight").done({ ...NOTHING, bodyweightLogged: true })).toBe(true);
  });

  it("the prescribed-day step is satisfied by the sheet OR by a session already running", () => {
    // Tapping fast enough to skip the confirm sheet is not a reason to stall.
    expect(stepById("start-day").done({ ...NOTHING, startSheetOpen: true })).toBe(true);
    expect(stepById("start-day").done({ ...NOTHING, activeSessionId: "s1" })).toBe(true);
  });

  it("opening a lift completes on the screen, not on the store", () => {
    // Bench Press is ALREADY the current lift, so opening it changes no store
    // value. Waiting on one is the bug that stranded people on this step.
    expect(
      stepById("open-lift").done({
        ...NOTHING,
        activeSessionId: "s1",
        currentExerciseId: "tut_bench",
        exerciseScreenOpen: true,
      }),
    ).toBe(true);
  });

  it("set 1 and set 2 wait for the count, so a correction cannot skip one", () => {
    expect(stepById("save-set-1").done({ ...NOTHING, sets: [set("1")] })).toBe(true);
    expect(stepById("save-set-2").done({ ...NOTHING, sets: [set("1")] })).toBe(false);
    expect(stepById("save-set-2").done({ ...NOTHING, sets: [set("1"), set("2")] })).toBe(true);
  });

  it("Back is complete when the app has moved on to another lift", () => {
    const back = stepById("back");
    expect(back.done({ ...NOTHING, currentExerciseId: "tut_bench" })).toBe(false);
    expect(back.done({ ...NOTHING, currentExerciseId: "tut_pulldown" })).toBe(true);
  });

  it("the summary's Done is complete when the summary goes", () => {
    expect(stepById("summary-done").done({ ...NOTHING, summaryShown: true })).toBe(false);
    expect(stepById("summary-done").done({ ...NOTHING, summaryShown: false })).toBe(true);
  });

  it("picking cardio accepts the picker or the form, so a fast tap cannot strand it", () => {
    const pick = stepById("pick-cardio");
    expect(pick.done({ ...NOTHING, cardioPickerOpen: true })).toBe(true);
    expect(pick.done({ ...NOTHING, cardioFormOpen: true })).toBe(true);
  });

  it("the cardio chapter ends on a logged session", () => {
    expect(stepById("cardio-save").done({ ...NOTHING, cardioLogged: true })).toBe(true);
  });
});

describe("stepsFor", () => {
  it("leaves the install chapter out where it cannot succeed", () => {
    const desktop = stepsFor({ canInstall: false });
    expect(desktop.some((s) => s.chapter === "install")).toBe(false);
    expect(desktop.length).toBe(TUTORIAL_STEPS.length - 1);
  });

  it("keeps every other step in the same order either way", () => {
    const phone = stepsFor({ canInstall: true }).filter((s) => s.chapter !== "install");
    expect(phone.map((s) => s.id)).toEqual(stepsFor({ canInstall: false }).map((s) => s.id));
  });
});

describe("resumePoint", () => {
  const steps = stepsFor({ canInstall: false });

  it("starts at the beginning when there is nothing to resume", () => {
    expect(resumePoint(steps, undefined)).toBe(0);
    expect(resumePoint(steps, "a-step-that-was-renamed")).toBe(0);
  });

  it("lands at the start of the chapter, never mid-chapter", () => {
    // The practice workout lives in memory only. Half of one is not something
    // to come back to.
    const index = resumePoint(steps, "save-set-2");
    expect(steps[index].id).toBe("start-day");
  });

  it("is exact for a chapter that is one step long", () => {
    const index = resumePoint(steps, "log-bodyweight");
    expect(steps[index].id).toBe("log-bodyweight");
  });
});
