/**
 * The nine tutorial steps as pure data and pure functions.
 *
 * ## Why pure data and pure functions
 *
 * This file contains no React, no DOM queries, and no store imports. The nine
 * steps describe what to say, what element to point at, and when an action is
 * considered complete.
 *
 * Every step predicate is a pure function over a `TutorialSeen` snapshot:
 * given what the app currently looks like, is this action complete? Because
 * there are no side effects or runtime dependencies, the entire progression
 * can be tested directly and exhaustively in memory without mounting a DOM or
 * running browser timers.
 *
 * ## Nothing blocks and nothing scolds
 *
 * Tapping something other than the target just does that thing and the step
 * waits. There is no wrong move, no error state, and no modal trapping the
 * user. This is the single most important behavioural rule of the tutorial.
 *
 * ## The two steps that must not be cut
 *
 * - Step 7 ("Set 2 copied what you just did. Log it too."): The app copying
 *   set 1 into set 2 is its single biggest advantage over a notes app, but it
 *   is invisible until it happens. Without noticing it, someone will retype
 *   every number forever.
 * - Step 8 ("Tap Done. Finishing a lift moves you on to the next one."): The
 *   app advancing to the next lift on its own is its core model of a session.
 *   Someone who misses this will think the highlight moved randomly.
 */

export interface WorkoutSet {
  readonly id: string;
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly weight: number;
  readonly reps: number;
  readonly rpe?: number;
  readonly setupNote?: string;
  readonly loggedAt: number;
}

/** What a step can see. Assembled per render from the store and the DOM. */
export interface TutorialSeen {
  chooserOpen: boolean;
  startSheetOpen: boolean;
  activeSessionId?: string;
  exerciseScreenOpen: boolean;
  currentExerciseId?: string;
  /** Sets logged in the tutorial session, oldest first. */
  sets: readonly WorkoutSet[];
  /** Which set row has its editor open, 1-based, or undefined. */
  editingRow?: number;
  summaryShown: boolean;
}

export interface TutorialStep {
  id: string;
  say: string;
  /** data-tutorial value the demo points at. */
  target: string;
  done: (seen: TutorialSeen) => boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "open-chooser",
    say: "Tap Add activity.",
    target: "add-activity",
    done: (seen) => seen.chooserOpen,
  },
  {
    id: "pick-strength",
    say: "Pick Strength.",
    target: "chooser-strength",
    done: (seen) => seen.startSheetOpen,
  },
  {
    id: "start",
    say: "Start Tutorial.",
    target: "start-confirm",
    done: (seen) => seen.activeSessionId !== undefined,
  },
  {
    id: "open-lift",
    say: "These are your lifts, in order. Open Bench Press.",
    target: "lift-row-first",
    done: (seen) => seen.exerciseScreenOpen,
  },
  {
    id: "tap-set-1",
    say: "Set 1 is already filled in. Tap it.",
    target: "set-row-1",
    done: (seen) => seen.editingRow === 1,
  },
  {
    id: "save-set-1",
    say: "Save takes those numbers as they are. Change one first if you lifted something else.",
    target: "set-save",
    done: (seen) => seen.sets.length >= 1,
  },
  {
    id: "save-set-2",
    say: "Set 2 copied what you just did. Log it too.",
    target: "set-row-2",
    done: (seen) => seen.sets.length >= 2,
  },
  {
    id: "back",
    say: "Tap Done. Finishing a lift moves you on to the next one.",
    target: "exercise-done",
    done: (seen) => seen.currentExerciseId !== undefined && seen.currentExerciseId !== "tut_bench",
  },
  {
    id: "end",
    say: "Tap End, top right.",
    target: "workout-end",
    done: (seen) => seen.summaryShown,
  },
] as const;
