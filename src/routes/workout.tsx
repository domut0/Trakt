import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { LogSetSheet } from "../components/LogSetSheet";
import { SessionView } from "../components/SessionView";
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
  const currentBlock = useStore((s) => s.currentBlock);
  const endWorkout = useStore((s) => s.endWorkout);
  const logNextInBlock = useStore((s) => s.logNextInBlock);
  const lastSetupNoteFor = useStore((s) => s.lastSetupNoteFor);

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
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="grid grid-cols-3 items-center px-5 pt-14">
        {/* Negative vertical margin matches touch target height without taller header bar */}
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="-my-3 flex min-h-[44px] items-center justify-self-start t-body font-medium text-accent"
        >
          Home
        </button>
        <div className="min-w-0 justify-self-center text-center">
          <div className="t-caption text-muted-foreground">Split</div>
          <h1 className="truncate t-body font-semibold">{slot.name}</h1>
        </div>
        <button
          onClick={handleEnd}
          className="-my-3 flex min-h-[44px] items-center justify-self-end t-body font-medium text-muted-foreground"
        >
          End
        </button>
      </div>

      {/* Stopwatch */}
      <div className="section-gap flex flex-col items-center">
        <div className="t-caption text-muted-foreground">Time between sets</div>
        <div className="tnum mt-1 text-[44px] font-semibold leading-none tracking-tight">
          {sessSets.length === 0 ? "0:00" : fmtTime(elapsedSinceLast)}
        </div>
      </div>

      {/* Current exercise */}
      <div className="section-gap flex flex-col items-center px-5 text-center">
        <div className="t-caption text-muted-foreground">Current exercise</div>
        <h2 className="mt-1 text-balance break-words t-title">
          {currentExercise?.name ?? <span className="text-muted-foreground">-</span>}
        </h2>
        {currentSetupNote && (
          <div className="mt-2 rounded-lg bg-muted px-3 py-2 t-label text-muted-foreground">
            {currentSetupNote}
          </div>
        )}
      </div>

      {/* Primary action */}
      <div className="section-gap flex flex-col items-center px-5">
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
          className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-accent text-accent-foreground"
        >
          <Plus size={30} aria-hidden="true" />
        </button>
        {inBlock && currentBlock ? (
          <div className="mt-2 text-center">
            <div className="t-label font-medium text-accent">Next set</div>
            <div className="tnum t-label text-muted-foreground">
              {currentBlock.loggedInBlock + 1} of {currentBlock.targetSets} · {currentBlock.weight}{" "}
              × {currentBlock.reps}
              {currentBlock.rpe != null ? ` @ ${currentBlock.rpe}` : ""}
            </div>
          </div>
        ) : (
          <div className="mt-2 t-label font-medium text-accent">Log set</div>
        )}
      </div>

      {/* Bottom row: session summary (left) + View workout (right) */}
      <div
        className="mt-auto flex items-end justify-between px-5 pt-7"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div>
          <div className="t-caption text-muted-foreground">This session</div>
          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <span className="t-stat">{sessSets.length}</span>{" "}
              <span className="t-label text-muted-foreground">sets</span>
            </div>
            <div>
              <span className="t-stat">{new Set(sessSets.map((s) => s.exerciseId)).size}</span>{" "}
              <span className="t-label text-muted-foreground">exercises</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowView(true)}
          className="flex min-h-[44px] shrink-0 items-center rounded-full bg-surface px-4 py-2 t-body font-medium"
        >
          View workout
        </button>
      </div>

      <LogSetSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onLogged={flashLogged} />

      {showView && (
        <div
          className="fixed inset-x-0 top-0 z-50 h-[100dvh] bg-background anim-backdrop"
          onClick={() => setShowView(false)}
        >
          <div
            className="mx-auto flex h-full max-w-md flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-14 pb-3">
              <button
                onClick={() => setShowView(false)}
                className="-my-3 flex min-h-[44px] shrink-0 items-center t-body font-medium text-accent"
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
          className="anim-toast pointer-events-none fixed bottom-36 left-1/2 z-[60] flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 t-label font-semibold text-background shadow-lg"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent">
            <Check size={11} strokeWidth={3.5} className="text-accent-foreground" />
          </span>
          Set logged
        </div>
      )}
    </div>
  );
}
