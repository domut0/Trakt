import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Plus } from "../components/icons";
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

  const [sheetOpen, setSheetOpen] = useState(false);
  const [showView, setShowView] = useState(false);
  /**
   * The finished workout, once End has been pressed. Held here rather than
   * derived, because `endWorkout` clears `activeSessionId` and every value the
   * summary is built from goes with it.
   */
  const [summary, setSummary] = useState<WorkoutSummaryData | null>(null);

  /*
    There is no "Set logged" toast on this screen any more, and it is not a
    removal so much as a replacement.

    It was a floating inked block pinned above the log bar. Once the set list
    began stacking upward from that bar, any fixed position over the list
    collides with it eventually: at bottom-52 it sat on the two newest rows by
    the third or fourth set, and two inked blocks at the same weight merge into
    one shape rather than overlapping. Moving it anywhere else on this layout
    only changes which set count breaks it.

    The row IS the confirmation now. A logged set mounts a new row directly
    above the button that made it, at the thumb, and that row lands with the
    app's flap. That is better feedback than a label that says a thing
    happened, because it shows the thing that happened, it is permanent, and it
    cannot collide with the list it is part of.
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

  /**
   * The lifts this workout's SLOT is for, in the order they were chosen, or null
   * when the slot has none. Null is the common case until the user plans one.
   *
   * Read off the slot rather than off a weekday, because the rotation this plans
   * has no weekdays in it: UL×infinity advances when you train. That also makes
   * the lookup independent of the date entirely, so a workout begun at 11pm
   * cannot lose its plan at midnight - there is no date in the question any more.
   *
   * Lifts whose exercise has since been deleted are dropped here rather than
   * stored pruned, so deleting an exercise never has to walk every slot.
   */
  const planned = useMemo(() => {
    if (!session?.splitSlotId) return null;
    const slot = slots.find((sl) => sl.id === session.splitSlotId);
    if (!slot?.plannedExerciseIds?.length) return null;
    const lifts = slot.plannedExerciseIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is Exercise => e !== undefined);
    return lifts.length > 0 ? { name: slot.name, lifts } : null;
  }, [slots, session, exercises]);
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
          <div className="mt-1 t-stat text-ink">
            {sessSets.length === 0 ? "0:00" : fmtTime(elapsedSinceLast)}
          </div>
        </div>
      </div>

      {currentSetupNote && (
        <div className="mx-4 mt-2 rounded-md bg-wash px-4 py-2 t-label text-ink-2">
          {currentSetupNote}
        </div>
      )}

      {/*
        The sets you have actually logged, newest first.

        This space used to be empty paper. The plan feature is opt-in and most
        days are unplanned, which the memo above calls the overwhelmingly common
        case, so the default state of the app's most-used screen was a header, a
        button, and roughly 350px of nothing. Worse, the set you had just logged
        was invisible: the only way to see it was to open "View workout", which
        is a full-screen overlay you have to dismiss to log the next one.

        A workout is a record being written, so the record is on the page while
        you write it. Newest first because the set you just logged is the one you
        are checking, and it is the row the log button is nearest to.

        Only rendered when there is no plan. With a plan the same space is the
        plan list, which is an offer about what comes NEXT and outranks a
        transcript of what already happened.
      */}
      {/*
        Stacked UP from the log bar, not down from the header.

        The rows grow towards the button rather than away from it, so the set
        you just logged is always the row nearest your thumb and the blank
        paper collects at the top where nothing needs it. Logging the first
        set of a session otherwise put one row under the header and left the
        whole 700px middle empty between it and the control that made it.
      */}
      {!planned && sessSets.length > 0 && (
        <section className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
          <ul>
            {[...sessSets].reverse().map((set, idx) => {
              const ex = exercises.find((e) => e.id === set.exerciseId);
              return (
                <li
                  key={set.id}
                  className={`flex items-baseline justify-between gap-3 px-4 py-2.5 ${
                    idx > 0 ? "group-row-sep" : "anim-flap-row"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate t-body text-ink">
                    {ex?.name ?? "Unknown exercise"}
                  </span>
                  <span className="shrink-0 tnum t-body text-ink">
                    {set.weight} {unit} × {set.reps}
                    {set.rpe != null && <span className="t-label text-ink-2"> @ {set.rpe}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
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
        <section className="section-gap min-h-0 flex-1 overflow-y-auto px-4">
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
                      isCurrent ? "rounded-md bg-ink text-paper" : "text-ink"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {/* Same filled-versus-open square as a ticked habit. */}
                      <span
                        aria-hidden="true"
                        className={`h-[14px] w-[14px] shrink-0 rounded-sm ${
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
      <div className="mt-auto px-4 pb-4">
        <button
          onClick={() => {
            if (inBlock) {
              logNextInBlock();
            } else {
              setSheetOpen(true);
            }
          }}
          aria-label={inBlock ? "Log the next set in this block" : "Log a set"}
          className="flex min-h-[72px] w-full items-center justify-between gap-3 bg-ink px-4 text-paper rounded-md"
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
          <Plus size={26} className="shrink-0" />
        </button>
      </div>

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

      <LogSetSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

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
