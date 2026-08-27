import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { Flap } from "../components/Flap";
import { LogSetSheet } from "../components/LogSetSheet";
import { SessionView } from "../components/SessionView";
import { WorkoutSummaryScreen } from "../components/WorkoutSummaryScreen";
import { dayKey } from "../lib/daily-log";
import { useStore, type Exercise } from "../lib/store";
import { buildWorkoutSummary, type WorkoutSummaryData } from "../lib/workout-summary";

export const Route = createFileRoute("/workout")({
  head: () => ({
    meta: [
      { title: "Workout" },
      { name: "description", content: "Active workout logging." },
      { property: "og:title", content: "Workout in progress" },
      { property: "og:description", content: "Active workout logging." },
    ],
  }),
  component: WorkoutPage,
});

function useElapsed(fromMs: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fromMs == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fromMs]);
  if (fromMs == null) return 0;
  return Math.max(0, Math.floor((now - fromMs) / 1000));
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function WorkoutPage() {
  const router = useRouter();
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);
  const exercises = useStore((s) => s.exercises);
  const unit = useStore((s) => s.unit);
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const currentBlock = useStore((s) => s.currentBlock);
  const endWorkout = useStore((s) => s.endWorkout);
  const logNextInBlock = useStore((s) => s.logNextInBlock);
  const lastSetupNoteFor = useStore((s) => s.lastSetupNoteFor);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);
  const planEnabled = useStore((s) => s.planEnabled);
  // Subscribed rather than read through getState() so the list below reacts to
  // the plan being edited (or the feature being switched off) mid-workout.
  const plannedWeek = useStore((s) => s.plannedWeek);
  const plannedWorkoutForDate = useStore((s) => s.plannedWorkoutForDate);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [showView, setShowView] = useState(false);
  /**
   * The finished workout, once End has been pressed. Held here rather than
   * derived, because `endWorkout` clears `activeSessionId` and every value the
   * summary is built from goes with it.
   */
  const [summary, setSummary] = useState<WorkoutSummaryData | null>(null);

  // "Set logged" confirmation toast. The nonce keys the toast element so each
  // log remounts it and replays the slide-up/fade animation, even on rapid
  // consecutive logs (multi-set blocks).
  const [loggedToast, setLoggedToast] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashLogged = () => {
    setLoggedToast(Date.now());
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLoggedToast(null), 1600);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // No active session means there is nothing to log, so this route sends the
  // user home. The summary is the one exception: the session it describes has
  // just been ended on purpose, and the screen has to outlive it.
  useEffect(() => {
    if (!activeSessionId && !summary) router.navigate({ to: "/" });
  }, [activeSessionId, summary, router]);

  const session = sessions.find((s) => s.id === activeSessionId);
  const slot = slots.find((sl) => sl.id === session?.splitSlotId);
  const sessSets = sets
    .filter((s) => s.sessionId === activeSessionId)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const lastLoggedAt = sessSets[sessSets.length - 1]?.loggedAt;
  const elapsedSinceLast = useElapsed(lastLoggedAt);
  const currentExercise = exercises.find((e) => e.id === currentExerciseId);

  /**
   * The main lifts planned for this workout's day, in plan order, or null when
   * the day is unplanned. Null is the overwhelmingly common case: the feature
   * is opt-in and most days are rest days, and this screen then renders exactly
   * what it always has.
   *
   * Keyed on the session's OWN start date, not on today: a workout begun at
   * 11pm keeps the plan it opened with instead of losing it at midnight.
   *
   * `plannedWorkoutForDate` does the whole resolution, weekday rotation and
   * dropping lifts whose exercise has since been deleted, so nothing here
   * re-derives any of it. The `plannedWeek` guard is the cheap exit for a user
   * who has never planned anything, and is also what ties this memo to the
   * subscription above.
   */
  const planned = useMemo(() => {
    if (!planEnabled || !plannedWeek || !session) return null;
    const workout = plannedWorkoutForDate(dayKey(new Date(session.startedAt)));
    if (!workout) return null;
    const lifts = workout.exerciseIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is Exercise => e !== undefined);
    return lifts.length > 0 ? { name: workout.name, lifts } : null;
  }, [planEnabled, plannedWeek, plannedWorkoutForDate, session, exercises]);
  const currentSetupNote = currentExerciseId ? lastSetupNoteFor(currentExerciseId) : undefined;
  const inBlock = !!currentBlock && currentBlock.loggedInBlock < currentBlock.targetSets;

  const goHome = () => router.navigate({ to: "/" });

  /**
   * Ends the session, then shows what it came to.
   *
   * Order matters twice. The summary is assembled BEFORE `endWorkout`, which
   * clears the active session and everything read here along with it. And the
   * build is wrapped, because a summary is never worth the end of a workout: on
   * any failure the session still ends and the user still goes home, which is
   * exactly what this button did before there was a summary at all.
   */
  const handleEnd = () => {
    let data: WorkoutSummaryData | null = null;
    try {
      data = buildWorkoutSummary({
        session,
        slotName: slot?.name ?? "",
        sets,
        sessions,
        exercises,
        unit,
        endedAt: Date.now(),
      });
    } catch {
      data = null;
    }
    endWorkout();
    // Nothing logged means nothing to summarise, and ending an empty workout
    // stays the plain cancel it has always been.
    if (data) setSummary(data);
    else goHome();
  };

  if (summary) return <WorkoutSummaryScreen data={summary} onDone={goHome} />;

  if (!session || !slot) return null;

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-paper">
      {/*
        The screen is set as an attempt card: the split names the page in the
        margin, the lift you are on is the one large thing, and the clock sits
        in its own column beside it rather than above it.

        It used to be a centred vertical stack - stopwatch, then exercise, then
        an 88px disc - which put the two things you read between sets on
        different lines and spent the widest part of the screen on air. Nothing
        about the FLOW changes: same controls, same handlers, same order of
        operations.
      */}
      {/* Top bar. Negative vertical margin keeps the 44px touch targets without
          making the header taller. */}
      <div className="grid grid-cols-3 items-center px-5 pt-14 pb-2">
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="-my-3 flex min-h-[44px] items-center justify-self-start t-action t-body"
        >
          Home
        </button>
        <h1 className="min-w-0 truncate justify-self-center text-center t-caption text-ink-2">
          {slot.name}
        </h1>
        <button
          onClick={handleEnd}
          className="-my-3 flex min-h-[44px] items-center justify-self-end t-action t-body"
        >
          End
        </button>
      </div>

      {/* The lift, and the clock, as two columns of one ruled block. */}
      <div className="rule-heavy-t rule-b flex items-start gap-4 px-5 py-3">
        {/*
          The lift outranks the clock, and it did not in the first cut.

          The stopwatch was set at t-hero and the exercise at t-heading, which
          made the biggest thing on a gym screen a number the product spec
          describes as passive: count-up only, no alarms, no targets. What he
          needs off a glance between sets is WHICH LIFT, so that is the one set
          large.
        */}
        <div className="min-w-0 flex-1">
          <div className="t-caption text-ink-3">Current exercise</div>
          <h2 className="mt-1 text-balance break-words t-title text-ink">
            {currentExercise?.name ?? <span className="text-ink-3">Nothing chosen yet</span>}
          </h2>
        </div>
        <div className="w-[104px] shrink-0 text-right">
          {/* "Time between sets", never "rest time", and never shortened: the
              count necessarily includes performing the next set, given that you
              log after it, and the full phrase is what says so. This was
              trimmed to "Between sets" to fit the column and that quietly
              removed a product decision to save six characters. The column got
              wider instead. */}
          <div className="t-caption text-ink-3">Time between sets</div>
          <div className="mt-1 t-stat text-ink">
            {sessSets.length === 0 ? "0:00" : fmtTime(elapsedSinceLast)}
          </div>
        </div>
      </div>

      {currentSetupNote && (
        <div className="hairline-b bg-wash px-5 py-2 t-label text-ink-2">{currentSetupNote}</div>
      )}

      {/*
        Planned lifts, when the day has a plan.

        An OFFER, never a checklist. Nothing here gates the log button, the
        picker still reaches every exercise in the library, and an accessory that
        is not in the plan is logged exactly as it always was. Tapping a row only
        moves the current exercise, which is how a lift is taken out of order or
        stepped past: the plan never has to be satisfied, or dismissed, to log
        anything.

        `min-h-0` with its own scroller so a long hand-edited plan shortens
        instead of pushing the bottom row off a small screen.
      */}
      {planned && (
        <section className="section-gap min-h-0 flex-1 overflow-y-auto px-5">
          <div className="group-header">
            <h2 className="t-caption">Planned</h2>
            {planned.name.trim() && (
              <span className="truncate t-label text-ink-2">{planned.name}</span>
            )}
          </div>
          <ul className="group-list">
            {planned.lifts.map((ex, idx) => {
              const logged = sessSets.filter((s) => s.exerciseId === ex.id).length;
              const isCurrent = ex.id === currentExerciseId;
              return (
                <li key={ex.id}>
                  <button
                    onClick={() => setCurrentExercise(ex.id)}
                    aria-pressed={isCurrent}
                    /*
                      The lift you are on is an INKED ROW, which is the same mark
                      the week strip uses for the day you are on. One vocabulary
                      for "you are here" across the app, and on a two-ink page it
                      is the only unambiguous one: the previous version said it
                      with accent-coloured semibold text, which next to a plain
                      row is emphasis rather than position.
                    */
                    className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""} ${
                      isCurrent ? "bg-ink text-paper" : "text-ink"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {/* Same filled-versus-open square as a ticked habit. */}
                      <span
                        aria-hidden="true"
                        className={`h-[14px] w-[14px] shrink-0 ${
                          logged > 0
                            ? isCurrent
                              ? "bg-paper"
                              : "bg-ink"
                            : isCurrent
                              ? "border-paper border-[1.5px]"
                              : "mark-open"
                        }`}
                      />
                      <span className="truncate t-body">{ex.name}</span>
                    </span>
                    {logged > 0 && (
                      <span
                        className={`shrink-0 tnum t-label ${isCurrent ? "text-paper" : "text-ink-2"}`}
                      >
                        {logged} {logged === 1 ? "set" : "sets"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Bottom row: session summary (left) + View workout (right) */}
      {/*
        Primary action, and it sits in the bottom third on purpose.

        A full-width inked bar rather than an 88px disc. Three reasons and none
        of them is taste: nothing in this world is round; a bar is roughly four
        times the tap area of the disc it replaces, which is what a sweaty hand
        at arm's length actually needs; and the disc's own label had to sit
        underneath it, so the button and the words describing it were two
        objects. Here the button says what it does.
      */}
      <div className="mt-auto px-5 pb-4">
        <button
          onClick={() => {
            if (inBlock) {
              logNextInBlock();
              flashLogged();
            } else {
              setSheetOpen(true);
            }
          }}
          aria-label={inBlock ? "Log the next set in this block" : "Log a set"}
          className="flex min-h-[72px] w-full items-center justify-between gap-3 bg-ink px-5 text-paper"
        >
          <span className="min-w-0 text-left">
            <span className="block t-heading">{inBlock ? "Next set" : "Log set"}</span>
            {inBlock && currentBlock && (
              <span className="mt-0.5 block truncate tnum t-label">
                {currentBlock.loggedInBlock + 1} of {currentBlock.targetSets} ·{" "}
                {currentBlock.weight} × {currentBlock.reps}
                {currentBlock.rpe != null ? ` @ ${currentBlock.rpe}` : ""}
              </span>
            )}
          </span>
          <Plus size={26} aria-hidden="true" className="shrink-0" />
        </button>
      </div>

      <div
        className="rule-t flex items-end justify-between gap-4 px-5 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="min-w-0">
          <div className="t-caption text-ink-3">This workout</div>
          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <Flap value={sessSets.length}>
                <span className="t-stat text-ink">{sessSets.length}</span>
              </Flap>{" "}
              <span className="t-label text-ink-2">sets</span>
            </div>
            <div>
              <span className="t-stat text-ink">
                {new Set(sessSets.map((s) => s.exerciseId)).size}
              </span>{" "}
              <span className="t-label text-ink-2">exercises</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowView(true)}
          className="flex min-h-[44px] shrink-0 items-center t-action t-body"
        >
          View workout
        </button>
      </div>

      <LogSetSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onLogged={flashLogged} />

      {showView && (
        <div
          className="fixed inset-x-0 top-0 z-50 h-[100dvh] bg-paper anim-backdrop"
          onClick={() => setShowView(false)}
        >
          <div
            className="mx-auto flex h-full max-w-md flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rule-b flex items-center justify-between gap-3 px-5 pt-14 pb-3">
              <button
                onClick={() => setShowView(false)}
                className="-my-3 flex min-h-[44px] shrink-0 items-center t-action t-body"
              >
                Done
              </button>
              <div className="min-w-0 truncate t-body font-semibold">{slot.name}</div>
              <DeleteWorkoutButton sessionId={session.id} onDeleted={() => setShowView(false)} />
            </div>
            <div className="flex-1 overflow-y-auto">
              <SessionView sessionId={session.id} />
            </div>
          </div>
        </div>
      )}

      {loggedToast !== null && (
        <div
          key={loggedToast}
          role="status"
          aria-live="polite"
          // A stamped block, not a floating pill. The shadow went with the
          // radius: this world has no elevation, so a drop shadow was the one
          // mark on the screen pretending the page had depth.
          // bottom-52, not bottom-36. The log bar moved down into the thumb arc and
          // the toast was still anchored where the old 88px disc used to sit, so
          // the confirmation landed ON the button. Both are inked blocks, so they
          // did not overlap so much as merge into one shape with two labels.
          className="anim-toast pointer-events-none fixed bottom-52 left-1/2 z-[60] flex items-center gap-2 bg-ink px-4 py-2.5 t-label font-semibold text-paper"
        >
          <Check size={13} strokeWidth={3.5} aria-hidden="true" />
          Set logged
        </div>
      )}
    </div>
  );
}
