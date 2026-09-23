import { beforeEach, describe, expect, it } from "vitest";
import { dbReadOnlyReason } from "../db";
import { useStore } from "../store";
import { useCoachStore } from "../coach-store";
import { useTutorialStore } from "../tutorial-store";
import { TUTORIAL_SLOT_ID } from "../tutorial-fixture";
import { loadTutorialState, saveTutorialState } from "../tutorial-state";
import { dayKey } from "../daily-log";
import { stepsFor } from "../tutorial";

/** The user's own world, which must come back exactly as it went in. */
function realState() {
  return {
    hydrated: true,
    unit: "lbs" as const,
    exercises: [{ id: "real_squat", name: "Squat", type: "main" as const }],
    slots: [{ id: "real_slot", name: "Lower", rotationOrder: 0 }],
    sessions: [{ id: "real_sess", splitSlotId: "real_slot", startedAt: 1, endedAt: 2 }],
    sets: [
      {
        id: "real_set",
        sessionId: "real_sess",
        exerciseId: "real_squat",
        weight: 225,
        reps: 5,
        loggedAt: 1,
      },
    ],
    dailyLogs: [{ date: dayKey(new Date()), bodyweight: 181.4 }],
    nutritionPhases: [],
    plannedDays: [],
    activeSessionId: undefined,
    currentExerciseId: undefined,
    nextSlotId: undefined,
    restSince: undefined,
    lastAcceptedPlanAt: undefined,
    coachManaged: false,
  };
}

/** Walk the run until the given step id is current. */
function runTo(stepId: string) {
  const store = useTutorialStore.getState();
  for (let i = 0; i < 40; i++) {
    const { steps, step } = useTutorialStore.getState();
    if (steps[step]?.id === stepId) return;
    store.advance();
  }
  throw new Error(`never reached ${stepId}`);
}

beforeEach(() => {
  localStorage.clear();
  useCoachStore.setState({ viewing: undefined });
  useTutorialStore.getState().skip();
  useStore.setState(realState());
  localStorage.clear();
});

describe("starting", () => {
  it("refuses before the store has hydrated", () => {
    useStore.setState({ hydrated: false });
    expect(useTutorialStore.getState().start()).toBe(false);
  });

  it("refuses while a real workout is running", () => {
    useStore.setState({ activeSessionId: "real_sess" });
    expect(useTutorialStore.getState().start()).toBe(false);
  });

  it("refuses inside a client's view, where the data is not the user's", () => {
    useCoachStore.setState({
      viewing: { client: { id: "c", name: "Bob" }, pulledAt: Date.now() },
    } as never);
    expect(useTutorialStore.getState().start()).toBe(false);
  });

  it("opens on the first step and records that a run is under way", () => {
    expect(useTutorialStore.getState().start({ canInstall: false })).toBe(true);
    const { steps, step } = useTutorialStore.getState();
    expect(steps[step].id).toBe("open-settings");
    expect(loadTutorialState()?.startedAt).toBeTypeOf("number");
    expect(loadTutorialState()?.stepId).toBe("open-settings");
  });

  it("includes the install chapter only where it can succeed", () => {
    useTutorialStore.getState().start({ canInstall: true });
    expect(useTutorialStore.getState().steps[0].id).toBe("install");
  });
});

describe("the sandbox, and the line it starts at", () => {
  it("leaves the real store alone through the sheet, share and bodyweight chapters", () => {
    useTutorialStore.getState().start({ canInstall: false });

    for (const stepId of ["open-settings", "connect-sheet", "share-sheet", "log-bodyweight"]) {
      runTo(stepId);
      expect(dbReadOnlyReason(), stepId).toBeUndefined();
      expect(useTutorialStore.getState().sandboxed, stepId).toBe(false);
      // The user's own data is on screen, so a bodyweight typed here is real.
      expect(useStore.getState().exercises[0].id, stepId).toBe("real_squat");
    }
  });

  it("latches the database read-only BEFORE the fixture is swapped in", () => {
    useTutorialStore.getState().start({ canInstall: false });

    let latchedWhenSwapped: string | undefined = "not observed";
    const unsubscribe = useStore.subscribe((state) => {
      if (state.slots.some((s) => s.id === TUTORIAL_SLOT_ID)) {
        latchedWhenSwapped = dbReadOnlyReason();
      }
    });

    runTo("start-day");
    unsubscribe();

    // If this is ever undefined, fixture data is in a store whose writes reach
    // the user's real IndexedDB.
    expect(latchedWhenSwapped).toBe("tutorial");
  });

  it("puts the fixture card on today, so the day offers it by name", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("start-day");

    expect(useStore.getState().plannedCardFor(dayKey(new Date()))?.id).toBe(TUTORIAL_SLOT_ID);
  });

  it("prescribes two sets of Bench Press, so Back moves on after the second", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("start-day");

    const card = useStore.getState().slots.find((s) => s.id === TUTORIAL_SLOT_ID);
    expect(card?.plannedLifts?.[0]).toMatchObject({ exerciseId: "tut_bench", sets: 2 });
  });

  it("gives the user their own world back, and takes the latch off, on finish", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("cardio-save");
    expect(dbReadOnlyReason()).toBe("tutorial");

    useTutorialStore.getState().advance();

    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useStore.getState().exercises).toEqual(realState().exercises);
    expect(useStore.getState().sets).toEqual(realState().sets);
    expect(useStore.getState().slots).toEqual(realState().slots);
    expect(useTutorialStore.getState().active).toBe(false);
    expect(loadTutorialState()?.doneAt).toBeTypeOf("number");
  });

  it("does the same on skip, from inside the sandbox", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("save-set-2");
    expect(dbReadOnlyReason()).toBe("tutorial");

    useTutorialStore.getState().skip();

    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useStore.getState().exercises).toEqual(realState().exercises);
  });

  it("keeps the bodyweight, because it was never in the sandbox", () => {
    const today = dayKey(new Date());
    useTutorialStore.getState().start({ canInstall: false });
    runTo("log-bodyweight");

    useStore.getState().upsertDailyLog(today, { bodyweight: 179.2 });
    runTo("cardio-save");
    useTutorialStore.getState().advance();

    expect(useStore.getState().dailyLogs.find((l) => l.date === today)?.bodyweight).toBe(179.2);
  });
});

describe("skipping a step the app cannot finish", () => {
  it("moves past a step that offers it", () => {
    useTutorialStore.getState().start({ canInstall: false });
    useTutorialStore.getState().skipStep();
    expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
      "connect-sheet",
    );
  });

  it("does nothing on a step that does not", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("log-bodyweight");
    useTutorialStore.getState().skipStep();
    expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
      "log-bodyweight",
    );
  });
});

describe("resuming", () => {
  it("picks up at the start of the chapter it left", () => {
    saveTutorialState({ joinedAt: 1, startedAt: 2, stepId: "save-set-2" });

    useTutorialStore.getState().start({ canInstall: false, resume: true });

    const { steps, step } = useTutorialStore.getState();
    expect(steps[step].id).toBe("start-day");
    // Landing inside a sandboxed chapter brings the sandbox with it.
    expect(dbReadOnlyReason()).toBe("tutorial");
  });

  it("starts from the beginning when asked to resume with nothing stored", () => {
    useTutorialStore.getState().start({ canInstall: false, resume: true });
    expect(useTutorialStore.getState().step).toBe(0);
  });

  it("records the step as it goes, so an interruption has something to return to", () => {
    useTutorialStore.getState().start({ canInstall: false });
    runTo("log-bodyweight");
    expect(loadTutorialState()?.stepId).toBe("log-bodyweight");
  });
});

describe("the step list", () => {
  it("ends by finishing rather than by running off the end", () => {
    const steps = stepsFor({ canInstall: false });
    useTutorialStore.getState().start({ canInstall: false });
    runTo(steps[steps.length - 1].id);

    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().active).toBe(false);
  });
});
