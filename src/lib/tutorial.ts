/**
 * The tutorial, as pure data and pure functions.
 *
 * ## Why pure data and pure functions
 *
 * This file contains no React, no DOM queries, and no store imports. Every step
 * describes what to say, what element to point at, which screen it belongs on,
 * and when its action is complete.
 *
 * Every step predicate is a pure function over a `TutorialSeen` snapshot:
 * given what the app currently looks like, is this action complete? Because
 * there are no side effects or runtime dependencies, the entire progression can
 * be tested directly and exhaustively in memory, without mounting a DOM or
 * running browser timers.
 *
 * ## Seven chapters, three of them real
 *
 * The tutorial no longer starts and ends inside a practice workout. It begins
 * on the invite screen and carries someone through everything they have to do
 * once: put the app on their home screen, make the sheet, share it, log a
 * bodyweight, run a workout, and log a cardio bout.
 *
 * The first three chapters run on the REAL app, because there is no sandboxed
 * version of creating a file in somebody's Drive, and because the bodyweight
 * they type is a real bodyweight and keeping it is the honest thing to do. The
 * sandbox latches on at the workout and lifts after the cardio, so exactly the
 * two things that would otherwise pollute their history are the two things that
 * are thrown away.
 *
 * ## Nothing is a dead end
 *
 * The two chapters that depend on Google can fail for reasons the app has no
 * control over - a declined consent screen, no account, a build with no client
 * id. Those steps are `skippable`: the rail offers a way past, the checklist
 * keeps the task, and the tutorial goes on.
 *
 * ## The three steps that must not be cut
 *
 * - "Set 2 copied what you just did": the app copying set 1 into set 2 is its
 *   single biggest advantage over a notes app, and it is invisible until it
 *   happens. Someone who misses it retypes every number forever.
 * - "Tap Back. Finishing a lift moves you on": the app advancing to the next
 *   lift on its own is its whole model of a session. Someone who misses it
 *   thinks the highlight moved at random.
 * - "Every morning, one number": the bodyweight is the only thing in the app
 *   that has to happen at a particular time of day.
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

/**
 * A chapter is a thing you can be part-way through and come back to.
 *
 * Resuming is per chapter, not per step: the practice workout lives in memory
 * only, so someone who closes the app half way through one has nothing to come
 * back to and starts that chapter again. Coming back to a chapter you were on
 * is what "where I left off" means for everything else too.
 */
export type TutorialChapterId =
  "install" | "sheet" | "share" | "weight" | "workout" | "finish" | "cardio";

/** The chapters that run inside the sandbox, in order. */
export const SANDBOXED_CHAPTERS: readonly TutorialChapterId[] = ["workout", "finish", "cardio"];

export function isSandboxed(chapter: TutorialChapterId): boolean {
  return SANDBOXED_CHAPTERS.includes(chapter);
}

/** What a step can see. Assembled per render from the store and the DOM. */
export interface TutorialSeen {
  /** Running from the home screen, or the walkthrough has been read. */
  installHandled: boolean;
  sheetConnected: boolean;
  sharedWithCoach: boolean;
  bodyweightLogged: boolean;
  startSheetOpen: boolean;
  activeSessionId?: string;
  exerciseScreenOpen: boolean;
  currentExerciseId?: string;
  /** Sets logged in the tutorial session, oldest first. */
  sets: readonly WorkoutSet[];
  /** Which set row has its editor open, 1-based, or undefined. */
  editingRow?: number;
  summaryShown: boolean;
  chooserOpen: boolean;
  /** The cardio activity list is up. */
  cardioPickerOpen: boolean;
  /** An activity has been chosen, so the cardio form is up. */
  cardioFormOpen: boolean;
  cardioDurationTyped: boolean;
  cardioLogged: boolean;
}

export interface TutorialStep {
  id: string;
  chapter: TutorialChapterId;
  /**
   * The line on the rail. `{coach}` is replaced with the coach's name, so the
   * copy stays data and the rail stays the only thing that knows who they are.
   */
  say: string;
  /** data-tutorial value the spotlight cuts out and the demo points at. */
  target: string;
  /** The screen this step happens on. The rail navigates there itself. */
  route?: "/" | "/settings";
  /** Whether the rail offers a way past. See "Nothing is a dead end" above. */
  skippable?: boolean;
  done: (seen: TutorialSeen) => boolean;
}

/**
 * Every step, in order.
 *
 * The install chapter is dropped on a device that cannot install or already
 * has - see `stepsFor` - which is the only variation. Everything else is the
 * same sequence for everybody, because a tutorial that takes different paths is
 * a tutorial nobody can describe to anybody else.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "install",
    chapter: "install",
    say: "Keep Trakt on your home screen. Tap here and follow the steps.",
    target: "install-row",
    route: "/",
    skippable: true,
    done: (seen) => seen.installHandled,
  },
  {
    id: "connect-sheet",
    chapter: "sheet",
    say: "Your numbers mirror to a Google Sheet in your own Drive. Make it.",
    target: "connect-sheet",
    route: "/settings",
    skippable: true,
    done: (seen) => seen.sheetConnected,
  },
  {
    id: "share-sheet",
    chapter: "share",
    say: "Now give {coach} access to it. This is the only thing they can see.",
    target: "share-coach",
    route: "/settings",
    skippable: true,
    done: (seen) => seen.sharedWithCoach,
  },
  {
    id: "log-bodyweight",
    chapter: "weight",
    say: "Every morning, one number. Type today's bodyweight.",
    target: "stat-bodyweight",
    route: "/",
    done: (seen) => seen.bodyweightLogged,
  },
  {
    id: "start-day",
    chapter: "workout",
    say: "Looks like {coach} prescribed a workout. Tap Start Tutorial day.",
    target: "start-planned",
    route: "/",
    done: (seen) => seen.startSheetOpen || seen.activeSessionId !== undefined,
  },
  {
    id: "start-confirm",
    chapter: "workout",
    say: "Tap Tutorial to start it.",
    target: "start-confirm",
    done: (seen) => seen.activeSessionId !== undefined,
  },
  {
    id: "open-lift",
    chapter: "workout",
    say: "These are your lifts, in order. Open Bench Press.",
    target: "lift-row-first",
    done: (seen) => seen.exerciseScreenOpen,
  },
  {
    id: "tap-set-1",
    chapter: "workout",
    say: "Set 1 is already filled in, from the plan. Tap it.",
    target: "set-row-1",
    done: (seen) => seen.editingRow === 1,
  },
  {
    id: "save-set-1",
    chapter: "workout",
    say: "Log your first set, then tap Save.",
    target: "set-save",
    done: (seen) => seen.sets.length >= 1,
  },
  {
    id: "save-set-2",
    chapter: "workout",
    say: "Set 2 copied what you just did. Log it too.",
    target: "set-row-2",
    done: (seen) => seen.sets.length >= 2,
  },
  {
    id: "back",
    chapter: "finish",
    say: "That is Bench Press done. Tap Back, and the next lift comes up.",
    target: "exercise-back",
    done: (seen) => seen.currentExerciseId !== undefined && seen.currentExerciseId !== "tut_bench",
  },
  {
    id: "end",
    chapter: "finish",
    say: "You would work down the list. For now, tap End.",
    target: "workout-end",
    done: (seen) => seen.summaryShown,
  },
  {
    id: "summary-done",
    chapter: "finish",
    say: "That is what every workout ends with. Tap Done.",
    target: "summary-done",
    done: (seen) => !seen.summaryShown,
  },
  {
    id: "open-chooser",
    chapter: "cardio",
    say: "{coach} asked for conditioning too. Tap Add activity.",
    target: "add-activity",
    route: "/",
    done: (seen) => seen.chooserOpen,
  },
  {
    id: "pick-cardio",
    chapter: "cardio",
    say: "Pick Cardio.",
    target: "chooser-cardio",
    done: (seen) => seen.cardioPickerOpen || seen.cardioFormOpen,
  },
  {
    id: "pick-treadmill",
    chapter: "cardio",
    say: "Pick Treadmill.",
    target: "cardio-treadmill",
    done: (seen) => seen.cardioFormOpen,
  },
  {
    id: "cardio-duration",
    chapter: "cardio",
    say: "How long you were on it. Type the minutes.",
    target: "cardio-duration",
    done: (seen) => seen.cardioDurationTyped,
  },
  {
    id: "cardio-save",
    chapter: "cardio",
    say: "Tap Save. That is the whole of logging cardio.",
    target: "cardio-save",
    done: (seen) => seen.cardioLogged,
  },
] as const;

/**
 * The steps this device runs.
 *
 * The install chapter is left out where it cannot succeed - a desktop browser,
 * or an app already launched from the home screen - rather than shown and
 * excused. A step nobody can complete is not a step.
 */
export function stepsFor({ canInstall }: { canInstall: boolean }): readonly TutorialStep[] {
  return canInstall ? TUTORIAL_STEPS : TUTORIAL_STEPS.filter((s) => s.chapter !== "install");
}

/** The first step of the chapter `stepId` belongs to, which is where a resume lands. */
export function resumePoint(steps: readonly TutorialStep[], stepId: string | undefined): number {
  if (stepId === undefined) return 0;
  const index = steps.findIndex((s) => s.id === stepId);
  if (index < 0) return 0;
  const chapter = steps[index].chapter;
  return steps.findIndex((s) => s.chapter === chapter);
}

/** How many chapters this run has, and which one a step is in. Used by the rail. */
export function chaptersOf(steps: readonly TutorialStep[]): TutorialChapterId[] {
  const seen: TutorialChapterId[] = [];
  for (const step of steps) {
    if (!seen.includes(step.chapter)) seen.push(step.chapter);
  }
  return seen;
}
