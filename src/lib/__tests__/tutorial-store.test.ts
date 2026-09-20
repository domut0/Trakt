import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, dbReadOnlyReason, safeWrite, setDbReadOnly } from "../db";
import { useStore } from "../store";
import { useCoachStore } from "../coach-store";
import { useTutorialStore, isTutorialActive } from "../tutorial-store";
import { TUTORIAL_SLOT_ID, tutorialFixture, tutorialStoreState } from "../tutorial-fixture";
import { SWAPPED_KEYS, captureOwnState, type Swapped } from "../store-swap";
import { loadTutorialState } from "../tutorial-state";

/**
 * Tutorial sandbox store tests.
 *
 * Verifies the single most important invariant:
 * The latch goes on BEFORE the swap, and comes off AFTER the restore.
 * If the latch were ever left on with the user's real data back in the store,
 * the app would silently stop saving anything for the rest of the session.
 */

const REAL_USER_STATE: Swapped = {
  unit: "lbs",
  exercises: [
    { id: "e_squat", name: "Barbell Squat", type: "main" },
    { id: "e_bench", name: "Barbell Bench Press", type: "main" },
  ],
  slots: [
    {
      id: "slot_a",
      name: "Leg Day",
      rotationOrder: 0,
      plannedLifts: [{ exerciseId: "e_squat", sets: 3, reps: "5", load: "225 lbs" }],
    },
  ],
  sessions: [
    {
      id: "sess_real_1",
      splitSlotId: "slot_a",
      startedAt: 1700000000000,
      endedAt: 1700003600000,
    },
  ],
  sets: [
    {
      id: "set_real_1",
      sessionId: "sess_real_1",
      exerciseId: "e_squat",
      weight: 225,
      reps: 5,
      loggedAt: 1700001000000,
    },
  ],
  dailyLogs: [{ date: "2026-09-20", calories: 2400, weight: 185 }],
  nutritionPhases: [
    {
      id: "np_real",
      name: "Maintenance",
      calories: 2400,
      protein: 180,
      carbs: 250,
      fat: 75,
      startedAt: "2026-09-01",
    },
  ],
  plannedDays: [{ date: "2026-09-20", slotId: "slot_a" }],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  nextSlotId: "slot_a",
  restSince: undefined,
  lastAcceptedPlanAt: 1700000000000,
  coachManaged: false,
};

async function clearDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.nutritionPhases.clear(),
    db.plannedDays.clear(),
  ]);
}

beforeEach(async () => {
  localStorage.clear();
  setDbReadOnly(undefined);
  useTutorialStore.setState({ active: false, step: 0 });
  useCoachStore.setState({ viewing: undefined });
  useStore.setState({
    ...REAL_USER_STATE,
    hydrated: true,
  });
  await clearDb();
});

afterEach(async () => {
  // Ensure teardown even if a test failed mid-run
  if (useTutorialStore.getState().active) {
    useTutorialStore.getState().finish();
  }
  setDbReadOnly(undefined);
  vi.restoreAllMocks();
  await clearDb();
});

describe("tutorial fixture", () => {
  it("returns EVERY key in SWAPPED_KEYS", () => {
    const lbsState = tutorialStoreState("lbs");
    const kgState = tutorialStoreState("kg");

    for (const key of SWAPPED_KEYS) {
      expect(key in lbsState).toBe(true);
      expect(key in kgState).toBe(true);
    }
  });

  it("differs in kg and lbs load strings, and leaves curl unweighted", () => {
    const lbsFixture = tutorialFixture("lbs");
    const kgFixture = tutorialFixture("kg");

    const lbsBench = lbsFixture.slots[0].plannedLifts?.find((l) => l.exerciseId === "tut_bench");
    const kgBench = kgFixture.slots[0].plannedLifts?.find((l) => l.exerciseId === "tut_bench");
    expect(lbsBench?.load).toBe("135 lbs");
    expect(kgBench?.load).toBe("60 kg");

    const lbsPulldown = lbsFixture.slots[0].plannedLifts?.find(
      (l) => l.exerciseId === "tut_pulldown",
    );
    const kgPulldown = kgFixture.slots[0].plannedLifts?.find(
      (l) => l.exerciseId === "tut_pulldown",
    );
    expect(lbsPulldown?.load).toBe("100 lbs");
    expect(kgPulldown?.load).toBe("45 kg");

    // The third lift has no load on purpose
    const lbsCurl = lbsFixture.slots[0].plannedLifts?.find((l) => l.exerciseId === "tut_curl");
    const kgCurl = kgFixture.slots[0].plannedLifts?.find((l) => l.exerciseId === "tut_curl");
    expect(lbsCurl?.load).toBeUndefined();
    expect(kgCurl?.load).toBeUndefined();
  });

  it("has stable IDs and no kind, plannedCardio, or weekday on slot", () => {
    const { exercises, slots } = tutorialFixture("lbs");
    expect(slots[0].id).toBe(TUTORIAL_SLOT_ID);
    expect(slots[0].id).toBe("tut_slot");
    expect(slots[0].name).toBe("Tutorial");
    expect(slots[0].kind).toBeUndefined();
    expect((slots[0] as { plannedCardio?: unknown }).plannedCardio).toBeUndefined();
    expect(slots[0].weekday).toBeUndefined();

    const exIds = exercises.map((e) => e.id);
    expect(exIds).toEqual(["tut_bench", "tut_pulldown", "tut_curl"]);
  });
});

describe("start() refusal cases", () => {
  it("refuses when store is not hydrated", () => {
    useStore.setState({ hydrated: false });
    const started = useTutorialStore.getState().start();

    expect(started).toBe(false);
    expect(useTutorialStore.getState().active).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useStore.getState().exercises[0].id).toBe("e_squat");
  });

  it("refuses when a real workout is active", () => {
    useStore.setState({ hydrated: true, activeSessionId: "real_active_sess" });
    const started = useTutorialStore.getState().start();

    expect(started).toBe(false);
    expect(useTutorialStore.getState().active).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useStore.getState().activeSessionId).toBe("real_active_sess");
  });

  it("refuses while a coach is viewing a client", () => {
    useCoachStore.setState({
      viewing: {
        client: { id: "c_ann", name: "Ann", kind: "appsScript" },
        pulledAt: Date.now(),
      },
    });
    const started = useTutorialStore.getState().start();

    expect(started).toBe(false);
    expect(useTutorialStore.getState().active).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
  });

  it("refuses when the tutorial is already active", () => {
    useTutorialStore.setState({ active: true });
    const started = useTutorialStore.getState().start();

    expect(started).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
  });
});

describe("the single most important invariant: latch order and lifecycle", () => {
  it("sets the latch BEFORE the store is swapped", () => {
    let latchWhenSwapped: string | undefined;

    const origSetState = useStore.setState;
    vi.spyOn(useStore, "setState").mockImplementation((arg: unknown) => {
      // Check latch status right when useStore.setState is called during swap
      if (typeof arg === "object" && arg !== null && "exercises" in arg) {
        latchWhenSwapped = dbReadOnlyReason();
      }
      return origSetState(arg as Parameters<typeof origSetState>[0]);
    });

    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);
    expect(latchWhenSwapped).toBe("tutorial");
  });

  it("is ON during tutorial and OFF after finish() and after skip()", () => {
    // 1. Enter tutorial
    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);
    expect(useTutorialStore.getState().active).toBe(true);
    expect(isTutorialActive()).toBe(true);
    expect(dbReadOnlyReason()).toBe("tutorial");

    // 2. Exit via finish()
    useTutorialStore.getState().finish();
    expect(useTutorialStore.getState().active).toBe(false);
    expect(isTutorialActive()).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();

    // 3. Enter again and exit via skip()
    const startedAgain = useTutorialStore.getState().start();
    expect(startedAgain).toBe(true);
    expect(dbReadOnlyReason()).toBe("tutorial");

    useTutorialStore.getState().skip();
    expect(useTutorialStore.getState().active).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
  });

  it("releases the latch even when the restore throws (the unrecoverable bug)", () => {
    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);
    expect(dbReadOnlyReason()).toBe("tutorial");

    // Simulate an unexpected error while restoring state
    const origSetState = useStore.setState;
    vi.spyOn(useStore, "setState").mockImplementation(() => {
      throw new Error("simulated catastrophic store restore failure");
    });

    try {
      expect(() => useTutorialStore.getState().finish()).toThrow(
        "simulated catastrophic store restore failure",
      );
    } finally {
      vi.spyOn(useStore, "setState").mockImplementation(origSetState);
    }

    // THE LATCH MUST BE RELEASED!
    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useTutorialStore.getState().active).toBe(false);
  });

  it("releases the latch if an error occurs during start() swap", () => {
    const origSetState = useStore.setState;
    let callCount = 0;
    vi.spyOn(useStore, "setState").mockImplementation((arg: unknown) => {
      callCount++;
      // Throw on the swap call
      if (callCount === 1) {
        throw new Error("simulated failure during start swap");
      }
      return origSetState(arg as Parameters<typeof origSetState>[0]);
    });

    const started = useTutorialStore.getState().start();
    expect(started).toBe(false);
    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useTutorialStore.getState().active).toBe(false);
  });
});

describe("state restoration byte-identical check", () => {
  it("restores user state byte-identical after finish()", () => {
    const originalState = captureOwnState();

    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);

    // Verify tutorial state is active
    expect(useStore.getState().exercises[0].id).toBe("tut_bench");

    // Mutate state during tutorial workout (simulate logging sets and starting session)
    useStore.setState({
      activeSessionId: "tut_session_1",
      currentExerciseId: "tut_bench",
      sets: [
        {
          id: "tut_set_1",
          sessionId: "tut_session_1",
          exerciseId: "tut_bench",
          weight: 135,
          reps: 8,
          loggedAt: Date.now(),
        },
      ],
    });

    useTutorialStore.getState().finish();

    const restoredState = captureOwnState();
    expect(restoredState).toStrictEqual(originalState);
    expect(JSON.stringify(restoredState)).toBe(JSON.stringify(originalState));
  });

  it("restores user state byte-identical after skip()", () => {
    const originalState = captureOwnState();

    const started = useTutorialStore.getState().start();
    expect(started).toBe(true);

    // Mutate state
    useStore.setState({
      activeSessionId: "tut_session_2",
      nextSlotId: undefined,
    });

    useTutorialStore.getState().skip();

    const restoredState = captureOwnState();
    expect(restoredState).toStrictEqual(originalState);
    expect(JSON.stringify(restoredState)).toBe(JSON.stringify(originalState));
  });
});

describe("database protection and step advancement", () => {
  it("prevents safeWrite from executing while tutorial is active", () => {
    useTutorialStore.getState().start();
    expect(dbReadOnlyReason()).toBe("tutorial");

    const writeOp = vi.fn().mockResolvedValue(undefined);
    safeWrite(writeOp);
    expect(writeOp).not.toHaveBeenCalled();

    useTutorialStore.getState().finish();
    expect(dbReadOnlyReason()).toBeUndefined();

    safeWrite(writeOp);
    expect(writeOp).toHaveBeenCalledTimes(1);
  });

  it("writes nothing to Dexie during the entire tutorial", async () => {
    useTutorialStore.getState().start();

    // Log two sets and start workout directly
    useStore.getState().startWorkout(TUTORIAL_SLOT_ID);
    const activeSessionId = useStore.getState().activeSessionId;
    expect(activeSessionId).toBeDefined();

    useStore.getState().logSet({
      exerciseId: "tut_bench",
      weight: 135,
      reps: 8,
    });

    useStore.getState().logSet({
      exerciseId: "tut_bench",
      weight: 135,
      reps: 8,
    });

    // Wait a tick for any fire-and-forget writes
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Finish tutorial
    useTutorialStore.getState().finish();

    // Verify Dexie tables have ZERO tutorial records
    const [sessions, sets, slots] = await Promise.all([
      db.sessions.toArray(),
      db.sets.toArray(),
      db.slots.toArray(),
    ]);

    expect(sessions.find((s) => s.id === activeSessionId)).toBeUndefined();
    expect(sets.filter((s) => s.exerciseId === "tut_bench")).toHaveLength(0);
    expect(slots.find((s) => s.id === TUTORIAL_SLOT_ID)).toBeUndefined();
  });

  it("advances steps when active and resets on exit", () => {
    useTutorialStore.getState().start();
    expect(useTutorialStore.getState().step).toBe(0);

    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().step).toBe(1);

    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().step).toBe(2);

    useTutorialStore.getState().finish();
    expect(useTutorialStore.getState().step).toBe(0);
  });

  it("does not advance when tutorial is not active", () => {
    expect(useTutorialStore.getState().active).toBe(false);
    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().step).toBe(0);
  });

  it("marks tutorial done in localStorage on finish and on skip", () => {
    expect(loadTutorialState()?.doneAt).toBeUndefined();

    useTutorialStore.getState().start();
    useTutorialStore.getState().finish();
    expect(loadTutorialState()?.doneAt).toBeTypeOf("number");

    // Reset and test skip
    localStorage.clear();
    useTutorialStore.getState().start();
    useTutorialStore.getState().skip();
    expect(loadTutorialState()?.doneAt).toBeTypeOf("number");
  });
});
