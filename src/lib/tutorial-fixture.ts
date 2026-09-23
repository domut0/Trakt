import type { Exercise, PlannedLift, SplitSlot } from "./store";
import { SWAPPED_KEYS, type Swapped } from "./store-swap";

/**
 * The fixture card and lifts for the practice tutorial workout.
 *
 * ## Why a fixture rather than the client's coach card
 *
 * A client invited by a coach might have a real split waiting for them, or no
 * plan at all yet. The tutorial workout must be reproducible, self-contained,
 * and completely independent of whatever the coach programmed or whether the
 * client has accepted a plan.
 *
 * The card has three lifts designed to teach three distinct logging mechanics:
 * 1. Bench Press: a main lift with suggested sets, reps, and a ghost load.
 * 2. Lat Pulldown: an accessory lift, also ghosted with a suggested load.
 * 3. Incline DB Curl: an accessory lift with NO suggested load on purpose.
 *    This teaches the user what an unprompted lift looks like and lets them type
 *    their own numbers.
 *
 * All IDs are literal, stable strings so step predicates and tests can
 * reliably name them.
 */

export const TUTORIAL_SLOT_ID = "tut_slot";

/** The card, its three lifts, and the exercises they name. Unit-aware. */
export function tutorialFixture(unit: "lbs" | "kg"): {
  exercises: Exercise[];
  slots: SplitSlot[];
} {
  const exercises: Exercise[] = [
    { id: "tut_bench", name: "Bench Press", type: "main" },
    { id: "tut_pulldown", name: "Lat Pulldown", type: "accessory" },
    { id: "tut_curl", name: "Incline DB Curl", type: "accessory" },
  ];

  const plannedLifts: PlannedLift[] = [
    {
      // TWO, and it has to be two: the script logs set 1, logs set 2, then
      // says "Finishing a lift moves you on to the next one" and waits for
      // that to happen. `WorkoutLog`'s `done` only moves on from a lift whose
      // prescribed sets are all logged, so a third set here means the lift is
      // NOT finished, the app correctly stays put, the step's condition never
      // comes true, and the tutorial cannot be completed at all.
      exerciseId: "tut_bench",
      sets: 2,
      reps: "8",
      load: unit === "kg" ? "60 kg" : "135 lbs",
    },
    {
      exerciseId: "tut_pulldown",
      sets: 3,
      reps: "10",
      load: unit === "kg" ? "45 kg" : "100 lbs",
    },
    {
      exerciseId: "tut_curl",
      sets: 2,
      reps: "12",
      // No load on purpose: the blank row teaches the user what happens when
      // nothing was prescribed.
    },
  ];

  const slots: SplitSlot[] = [
    {
      id: TUTORIAL_SLOT_ID,
      name: "Tutorial",
      rotationOrder: 0,
      plannedLifts,
      // No kind: reads as "workout".
      // No plannedCardio or weekday: avoids finisher and week-schedule claims.
    },
  ];

  return { exercises, slots };
}

/**
 * The full swapped-state object handed to useStore.setState.
 *
 * Must contain EVERY key in SWAPPED_KEYS so that entering the tutorial
 * cleanly replaces all user state in memory.
 */
export function tutorialStoreState(unit: "lbs" | "kg"): Swapped {
  const { exercises, slots } = tutorialFixture(unit);

  const state: Swapped = {
    exercises,
    slots,
    sessions: [],
    sets: [],
    dailyLogs: [],
    // Empty nutrition phases is a deliberate choice and a legal state: phases
    // have real dates, and the practice day showing no targets is honest.
    nutritionPhases: [],
    plannedDays: [],
    unit,
    activeSessionId: undefined,
    currentExerciseId: undefined,
    nextSlotId: undefined,
    restSince: undefined,
    lastAcceptedPlanAt: undefined,
    coachManaged: false,
  };

  return state;
}
