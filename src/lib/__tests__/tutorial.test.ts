import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TUTORIAL_STEPS, type TutorialSeen, type WorkoutSet } from "../tutorial";
import { useTutorialStore } from "../tutorial-store";
import { useStore } from "../store";

const mockSet1: WorkoutSet = {
  id: "set_1",
  sessionId: "sess_tut",
  exerciseId: "tut_bench",
  weight: 135,
  reps: 8,
  loggedAt: 1000,
};

const mockSet2: WorkoutSet = {
  id: "set_2",
  sessionId: "sess_tut",
  exerciseId: "tut_bench",
  weight: 135,
  reps: 8,
  loggedAt: 2000,
};

const emptySeen: TutorialSeen = {
  chooserOpen: false,
  startSheetOpen: false,
  activeSessionId: undefined,
  exerciseScreenOpen: false,
  currentExerciseId: undefined,
  sets: [],
  editingRow: undefined,
  summaryShown: false,
};

describe("TUTORIAL_STEPS structure and IDs", () => {
  it("has exactly 9 steps in the prescribed order with unique IDs", () => {
    expect(TUTORIAL_STEPS).toHaveLength(9);

    const expectedIds = [
      "open-chooser",
      "pick-strength",
      "start",
      "open-lift",
      "tap-set-1",
      "save-set-1",
      "save-set-2",
      "back",
      "end",
    ];

    const actualIds = TUTORIAL_STEPS.map((s) => s.id);
    expect(actualIds).toEqual(expectedIds);

    const uniqueIds = new Set(actualIds);
    expect(uniqueIds.size).toBe(9);
  });

  it("has the exact target markers in order", () => {
    const expectedTargets = [
      "add-activity",
      "chooser-strength",
      "start-confirm",
      "lift-row-first",
      "set-row-1",
      "set-save",
      "set-row-2",
      "exercise-done",
      "workout-end",
    ];

    const actualTargets = TUTORIAL_STEPS.map((s) => s.target);
    expect(actualTargets).toEqual(expectedTargets);
  });

  it("has verbatim UI copy in sentence case with no em dashes", () => {
    const expectedCopy = [
      "Tap Add activity.",
      "Pick Strength.",
      "Start Tutorial.",
      "These are your lifts, in order. Open Bench Press.",
      "Set 1 is already filled in. Tap it.",
      "Save takes those numbers as they are. Change one first if you lifted something else.",
      "Set 2 copied what you just did. Log it too.",
      "Tap Done. Finishing a lift moves you on to the next one.",
      "Tap End, top right.",
    ];

    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      expect(TUTORIAL_STEPS[i].say).toBe(expectedCopy[i]);
      // Brand commitment: no em dashes in UI copy
      expect(TUTORIAL_STEPS[i].say).not.toContain("—");
      expect(TUTORIAL_STEPS[i].say).not.toContain("–");
    }
  });

  it("evaluates to false for every single predicate on an empty Seen snapshot", () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.done(emptySeen)).toBe(false);
    }
  });
});

describe("Tutorial step predicates and near-misses", () => {
  it("step 1 (open-chooser): fires only when chooserOpen is true", () => {
    const step = TUTORIAL_STEPS[0];
    expect(step.done({ ...emptySeen, chooserOpen: false })).toBe(false);
    expect(step.done({ ...emptySeen, chooserOpen: true })).toBe(true);

    // Near-miss: start sheet is open instead
    expect(step.done({ ...emptySeen, chooserOpen: false, startSheetOpen: true })).toBe(false);
  });

  it("step 2 (pick-strength): fires only when startSheetOpen is true", () => {
    const step = TUTORIAL_STEPS[1];
    expect(step.done({ ...emptySeen, startSheetOpen: false })).toBe(false);
    expect(step.done({ ...emptySeen, startSheetOpen: true })).toBe(true);

    // Near-miss: chooser is open instead
    expect(step.done({ ...emptySeen, startSheetOpen: false, chooserOpen: true })).toBe(false);
  });

  it("step 3 (start): fires only when activeSessionId is defined", () => {
    const step = TUTORIAL_STEPS[2];
    expect(step.done({ ...emptySeen, activeSessionId: undefined })).toBe(false);
    expect(step.done({ ...emptySeen, activeSessionId: "tut_session_1" })).toBe(true);

    // Near-miss: startSheetOpen is true but session not yet created
    expect(
      step.done({
        ...emptySeen,
        startSheetOpen: true,
        activeSessionId: undefined,
      }),
    ).toBe(false);
  });

  it("step 4 (open-lift): fires only when exerciseScreenOpen is true", () => {
    const step = TUTORIAL_STEPS[3];
    expect(step.done({ ...emptySeen, exerciseScreenOpen: false })).toBe(false);
    expect(step.done({ ...emptySeen, exerciseScreenOpen: true })).toBe(true);

    // Near-miss: session is active and bench is current, but exercise screen is not open
    expect(
      step.done({
        ...emptySeen,
        activeSessionId: "tut_session_1",
        currentExerciseId: "tut_bench",
        exerciseScreenOpen: false,
      }),
    ).toBe(false);
  });

  it("step 5 (tap-set-1): fires on editingRow 1, does NOT fire on editingRow 2 or undefined", () => {
    const step = TUTORIAL_STEPS[4];
    expect(step.done({ ...emptySeen, editingRow: undefined })).toBe(false);
    expect(step.done({ ...emptySeen, editingRow: 1 })).toBe(true);

    // Near-miss: user tapped row 2 instead of row 1
    expect(step.done({ ...emptySeen, editingRow: 2 })).toBe(false);
    expect(step.done({ ...emptySeen, editingRow: 3 })).toBe(false);
  });

  it("step 6 (save-set-1): fires when at least 1 set is logged", () => {
    const step = TUTORIAL_STEPS[5];
    expect(step.done({ ...emptySeen, sets: [] })).toBe(false);
    expect(step.done({ ...emptySeen, sets: [mockSet1] })).toBe(true);
    expect(step.done({ ...emptySeen, sets: [mockSet1, mockSet2] })).toBe(true);

    // Near-miss: row 1 was editing but Save was not pressed (no sets logged)
    expect(step.done({ ...emptySeen, editingRow: 1, sets: [] })).toBe(false);
  });

  it("step 7 (save-set-2): fires when at least 2 sets are logged, does NOT fire on 1 set", () => {
    const step = TUTORIAL_STEPS[6];
    expect(step.done({ ...emptySeen, sets: [] })).toBe(false);
    // Near-miss: only set 1 logged
    expect(step.done({ ...emptySeen, sets: [mockSet1] })).toBe(false);

    expect(step.done({ ...emptySeen, sets: [mockSet1, mockSet2] })).toBe(true);
  });

  it("step 8 (back): fires when finished lift moves user to next lift", () => {
    const step = TUTORIAL_STEPS[7];
    // Empty seen: undefined currentExerciseId -> false
    expect(step.done({ ...emptySeen, currentExerciseId: undefined })).toBe(false);

    // Near-miss: still on tut_bench
    expect(step.done({ ...emptySeen, currentExerciseId: "tut_bench" })).toBe(false);

    // Advanced to next lift (tut_pulldown)
    expect(step.done({ ...emptySeen, currentExerciseId: "tut_pulldown" })).toBe(true);
    expect(step.done({ ...emptySeen, currentExerciseId: "tut_curl" })).toBe(true);
  });

  it("step 9 (end): fires only when summaryShown is true", () => {
    const step = TUTORIAL_STEPS[8];
    expect(step.done({ ...emptySeen, summaryShown: false })).toBe(false);
    expect(step.done({ ...emptySeen, summaryShown: true })).toBe(true);

    // Near-miss: 2 sets logged and on pulldown, but summary not yet shown
    expect(
      step.done({
        ...emptySeen,
        sets: [mockSet1, mockSet2],
        currentExerciseId: "tut_pulldown",
        summaryShown: false,
      }),
    ).toBe(false);
  });
});

describe("advancing past step 9 calls finish", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      activeSessionId: undefined,
      currentExerciseId: undefined,
    });
    useTutorialStore.setState({ active: false, step: 0 });
  });

  afterEach(() => {
    useTutorialStore.getState().skip();
  });

  it("advances through steps 0 to 8, and advancing past step 8 (step 9) calls finish", () => {
    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);
    expect(useTutorialStore.getState().active).toBe(true);
    expect(useTutorialStore.getState().step).toBe(0);

    // Advance 8 times to reach step index 8 (the 9th step, "end")
    for (let i = 1; i <= 8; i++) {
      useTutorialStore.getState().advance();
      expect(useTutorialStore.getState().step).toBe(i);
      expect(useTutorialStore.getState().active).toBe(true);
    }

    // Now on step index 8 (step 9: "end").
    expect(useTutorialStore.getState().step).toBe(8);

    // Advancing past step 9 must call finish (teardown) rather than running off the end
    useTutorialStore.getState().advance();

    // Active should be false, step reset to 0
    expect(useTutorialStore.getState().active).toBe(false);
    expect(useTutorialStore.getState().step).toBe(0);
  });
});
