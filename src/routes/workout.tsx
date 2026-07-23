import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { LogSetSheet } from "../components/LogSetSheet";
import { SessionView } from "../components/SessionView";
import { detectSessionPRs, formatPRMessage } from "../lib/pr-detection";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/workout")({
  head: () => ({
    meta: [
      { title: "Workout — Anything But The Notes App" },
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
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const currentBlock = useStore((s) => s.currentBlock);
  const endWorkout = useStore((s) => s.endWorkout);
  const logNextInBlock = useStore((s) => s.logNextInBlock);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [showView, setShowView] = useState(false);
  const [motivationMsg, setMotivationMsg] = useState<string | null>(null);
  const motivationEnabled = useStore((s) => s.motivationEnabled);

  useEffect(() => {
    if (!activeSessionId) router.navigate({ to: "/" });
  }, [activeSessionId, router]);

  const session = sessions.find((s) => s.id === activeSessionId);
  const slot = slots.find((sl) => sl.id === session?.splitSlotId);
  const sessSets = sets.filter((s) => s.sessionId === activeSessionId).sort((a, b) => a.loggedAt - b.loggedAt);
  const lastLoggedAt = sessSets[sessSets.length - 1]?.loggedAt;
  const elapsedSinceLast = useElapsed(lastLoggedAt);
  const currentExercise = exercises.find((e) => e.id === currentExerciseId);
  const inBlock = !!currentBlock && currentBlock.loggedInBlock < currentBlock.targetSets;

  const handleEnd = () => {
    const msg = motivationEnabled
      ? formatPRMessage(
          detectSessionPRs({ sessionSets: sessSets, allSets: sets, exercises, now: Date.now() }),
        )
      : null;
    if (msg) {
      // Show the toast on this screen before ending the workout: ending
      // clears activeSessionId, which the effect above turns into an
      // immediate navigate away, unmounting this screen (and the toast)
      // before it could be seen.
      setMotivationMsg(msg);
      setTimeout(() => {
        setMotivationMsg(null);
        endWorkout();
        router.navigate({ to: "/" });
      }, 2600);
    } else {
      endWorkout();
      router.navigate({ to: "/" });
    }
  };

  if (!session || !slot) return null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-14">
        <button onClick={() => router.navigate({ to: "/" })} className="text-[15px] font-medium text-accent">Home</button>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Split</div>
          <div className="text-[15px] font-semibold tracking-tight">{slot.name}</div>
        </div>
        <button onClick={handleEnd} className="text-[15px] font-medium text-muted-foreground">End</button>
      </div>

      {/* Stopwatch */}
      <div className="mt-10 flex flex-col items-center">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Time between sets</div>
        <div className="tnum mt-1 text-[52px] font-semibold leading-none tracking-tight">
          {sessSets.length === 0 ? "0:00" : fmtTime(elapsedSinceLast)}
        </div>
      </div>

      {/* Current exercise */}
      <div className="mt-10 flex flex-col items-center px-5 text-center">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Current exercise</div>
        <div className="mt-1 text-[26px] font-semibold tracking-tight">
          {currentExercise?.name ?? <span className="text-muted-foreground/60">—</span>}
        </div>
        {currentExercise?.setupNote && (
          <div className="mt-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">{currentExercise.setupNote}</div>
        )}
      </div>

      {/* Primary action */}
      <div className="mt-8 flex flex-col items-center px-5">
        <button
          onClick={() => (inBlock ? logNextInBlock() : setSheetOpen(true))}
          className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-accent text-accent-foreground"
        >
          <Plus size={30} />
        </button>
        {inBlock && currentBlock ? (
          <div className="mt-2 text-center">
            <div className="text-[13px] font-medium text-accent">Next set</div>
            <div className="text-[12px] text-muted-foreground">
              {currentBlock.loggedInBlock + 1} of {currentBlock.targetSets} · {currentBlock.weight} × {currentBlock.reps}{currentBlock.rpe != null ? ` @ ${currentBlock.rpe}` : ""}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-[13px] font-medium text-accent">Log set</div>
        )}
      </div>

      {/* Bottom row: session summary (left) + View Workout (right) */}
      <div className="mt-auto flex items-end justify-between px-5 pb-8 pt-8">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">This session</div>
          <div className="mt-1 flex items-baseline gap-4">
            <div><span className="tnum text-[22px] font-semibold">{sessSets.length}</span> <span className="text-[12px] text-muted-foreground">sets</span></div>
            <div><span className="tnum text-[22px] font-semibold">{new Set(sessSets.map(s => s.exerciseId)).size}</span> <span className="text-[12px] text-muted-foreground">exercises</span></div>
          </div>
        </div>
        <button onClick={() => setShowView(true)} className="rounded-full bg-surface px-4 py-2 text-[13px] font-medium hairline-t hairline-b">
          View Workout
        </button>
      </div>

      <LogSetSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {showView && (
        <div className="fixed inset-0 z-50 bg-background" onClick={() => setShowView(false)}>
          <div className="mx-auto flex h-full max-w-md flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-14 pb-3">
              <button onClick={() => setShowView(false)} className="text-[15px] font-medium text-accent">Done</button>
              <div className="text-[15px] font-semibold tracking-tight">{slot.name}</div>
              <span className="w-10" />
            </div>
            <div className="flex-1 overflow-y-auto">
              <SessionView sessionId={session.id} />
            </div>
          </div>
        </div>
      )}

      {motivationMsg && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-5 py-3 text-[13px] font-medium text-background shadow-lg">
          {motivationMsg}
        </div>
      )}
    </div>
  );
}
