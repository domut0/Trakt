import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { Flap } from "../components/Flap";
import { SessionView } from "../components/SessionView";
import { WorkoutLog } from "../components/WorkoutLog";
import { TutorialBanner } from "../components/TutorialBanner";
import { WorkoutSummaryScreen } from "../components/WorkoutSummaryScreen";
import { useStore } from "../lib/store";
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
  const endWorkout = useStore((s) => s.endWorkout);

  const [showView, setShowView] = useState(false);
  /**
   * The finished workout, once End has been pressed. Held here rather than
   * derived, because `endWorkout` clears `activeSessionId` and every value the
   * summary is built from goes with it.
   */
  const [summary, setSummary] = useState<WorkoutSummaryData | null>(null);

  /*
    There is no log bar on this screen any more, and no "Sets: N" stepper
    behind it.

    Both belonged to a model where the unit being logged was a SET and the
    exercise was a setting on the sheet that logged it - which is how the sheet
    could open on the previous lift, and why logging three straight sets needed
    a target count declared up front and then counted down. The unit is the
    exercise now. Its sets are rows inside it, a row is tapped to log or to
    correct it, and nothing has to be told in advance how many there will be.
  */

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
  // Formatted once, so this screen and the exercise screen show one clock
  // rather than two that tick a second apart.
  const stopwatch = sessSets.length === 0 ? "0:00" : fmtTime(elapsedSinceLast);

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
      <TutorialBanner />
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
      <div className="grid grid-cols-3 items-center px-4 pt-14 pb-2">
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

      {/* The lift, and the clock. A card rather than a block ruled top and
          bottom: on a dark ground the card edge already says where it stops. */}
      <div className="mx-4 mt-3 flex items-start gap-4 rounded-lg bg-surface px-4 py-3">
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
          <div className="mt-1 t-stat text-ink">{stopwatch}</div>
        </div>
      </div>

      {/*
        The workout's exercises, and what each one opens.

        This space used to hold two different lists - a transcript of logged
        sets on an unplanned day, a plan list on a planned one - and a log bar
        under whichever was showing. One list does both jobs now: a plan puts
        rows in it before you start, and anything logged or added off-plan
        joins them. The count on the right is the transcript.
      */}
      <WorkoutLog sessionId={session.id} lifts={slot.plannedLifts ?? []} stopwatch={stopwatch} />

      <div
        className="flex items-end justify-between gap-4 px-4 pt-3"
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

      {showView && (
        <div
          className="fixed inset-x-0 top-0 z-50 h-[100dvh] bg-paper anim-backdrop"
          onClick={() => setShowView(false)}
        >
          <div
            className="mx-auto flex h-full max-w-md flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-14 pb-3">
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
    </div>
  );
}
