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
  /**
   * Whether this browser has a way to install at all: Android holding a
   * deferred prompt, or iOS Safari, where it is done by hand.
   *
   * Read every tick with everything else, and deliberately NOT decided once
   * when the run starts. Chrome only fires `beforeinstallprompt` after its own
   * engagement heuristics are satisfied, which can be seconds after load or
   * never, so a run that sampled this at start could drop the home-screen
   * chapter on a phone that was perfectly capable of installing a moment
   * later.
   */
  canInstall: boolean;
  /** Running from the home screen, or the walkthrough has been read. */
  installHandled: boolean;
  /** Whether Settings is the screen currently on. */
  atSettings: boolean;
  /** Whether this build can sign in to Google at all. */
  sheetPossible: boolean;
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
  /**
   * When this step cannot happen at all, so the rail passes it without a word.
   *
   * Sharing a sheet that was never made is the case this exists for: the
   * control is not merely disabled, it is not rendered, so the rail would have
   * sat there saying "give Marcus access to it" with nothing on screen to give
   * them access with. That is the exact failure the spotlight was built to
   * stop, and a step can cause it to itself.
   */
  unreachable?: (seen: TutorialSeen) => boolean;
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
    say: "Add Trakt to your home screen.",
    target: "install-row",
    route: "/",
    skippable: true,
    // Nothing to install with, so nothing to say here. The step below is what
    // that case gets instead.
    unreachable: (seen) => !seen.canInstall,
    done: (seen) => seen.installHandled,
  },
  {
    /**
     * The same chapter, for a browser that cannot install.
     *
     * This used to be silence: the whole chapter was filtered out when the
     * browser reported no install path, on the reasoning that "add to home
     * screen" means nothing on a desktop. But Trakt is a phone app, and a
     * client who opens their coach's invite on a laptop is the one person who
     * most needs telling so. They were the only ones told nothing.
     *
     * It cannot detect its own completion -- there is no event for "went and
     * got their phone" -- so it is skippable, and Skip is the way past. The
     * target does not exist on this screen, which is deliberate and safe: the
     * spotlight cuts no hole and dims nothing when it cannot find one, so the
     * app stays usable while the line is up.
     */
    id: "install-elsewhere",
    chapter: "install",
    say: "Trakt is made for your phone. Open this link there.",
    target: "install-row",
    route: "/",
    skippable: true,
    unreachable: (seen) => seen.canInstall || seen.installHandled,
    done: () => false,
  },
  {
    // Tapping the gear, rather than being moved there. Settings is where the
    // two things a coach needs live, and somebody who was teleported to it
    // cannot get back to it on their own afterwards.
    id: "open-settings",
    chapter: "sheet",
    say: "Your numbers go to a Google Sheet. Open Settings.",
    target: "settings-gear",
    skippable: true,
    unreachable: (seen) => !seen.sheetPossible,
    done: (seen) => seen.atSettings,
  },
  {
    id: "connect-sheet",
    chapter: "sheet",
    say: "Connect a Google Sheet.",
    target: "connect-sheet",
    route: "/settings",
    skippable: true,
    // A build with no OAuth client id renders the button disabled. Spotlighting
    // a control that cannot be pressed and saying "make it" is the tutorial
    // describing a screen that is not there.
    unreachable: (seen) => !seen.sheetPossible,
    done: (seen) => seen.sheetConnected,
  },
  {
    id: "share-sheet",
    chapter: "share",
    say: "Share it with {coach}.",
    target: "share-coach",
    route: "/settings",
    skippable: true,
    // Settings renders no share control until there is a sheet to share.
    unreachable: (seen) => !seen.sheetConnected,
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
    say: "Set 1 is already filled in. Tap it.",
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
    id: "tap-set-2",
    chapter: "workout",
    say: "Set 2 copied what you just did. Tap it.",
    target: "set-row-2",
    done: (seen) => seen.editingRow === 2,
  },
  {
    // Its own step, because the spotlight only lets through what the step
    // names: while "log set 2" pointed at the ROW, tapping the row opened an
    // editor whose Save button was outside the hole and inert.
    id: "save-set-2",
    chapter: "workout",
    say: "Same numbers, already filled in. Save it.",
    target: "set-save",
    done: (seen) => seen.sets.length >= 2,
  },
  {
    id: "back",
    chapter: "finish",
    // Done rather than Back, because by this step the exercise screen has a
    // full-width Done on it: it appears once a set has been logged, and two
    // have. Pointing at the corner control instead would leave the spotlight
    // dimming the obvious button and making it inert, which is the "looked
    // broken rather than firm" failure the spotlight exists to avoid. Both
    // controls call the same handler, so the predicate below is unchanged.
    say: "Bench Press finished. Tap Done and the next lift comes up.",
    target: "exercise-done",
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
    say: "Tap Done.",
    target: "summary-done",
    done: (seen) => !seen.summaryShown,
  },
  {
    id: "open-chooser",
    chapter: "cardio",
    say: "{coach} asked for cardio too. Tap Add activity.",
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
    say: "Tap Save.",
    target: "cardio-save",
    done: (seen) => seen.cardioLogged,
  },
] as const;

/**
 * The steps this device runs, which is all of them.
 *
 * This used to drop the install chapter when the device could not install,
 * decided once from a flag passed in at start. Two things were wrong with
 * that. A caller could simply forget the flag -- one did, so the tutorial
 * opened from Settings lost the chapter on every device, iPhones included --
 * and the answer was fixed at start, while Chrome decides whether an install
 * is possible on its own schedule and often after the run has begun.
 *
 * So no step is removed. Each one says for itself, every tick, whether there
 * is anything for it to do, and `unreachable` passes it in silence when there
 * is not. That is the same mechanism the sheet chapter already uses for a
 * build with no Google client id.
 */
export function stepsFor(): readonly TutorialStep[] {
  return TUTORIAL_STEPS;
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
