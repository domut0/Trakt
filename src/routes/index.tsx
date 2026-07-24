import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { StartWorkoutSheet } from "../components/StartWorkoutSheet";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "A frictionless workout logger for lifters. Weight and reps — nothing else in the way.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "A frictionless workout logger for lifters. Weight and reps — nothing else in the way.",
      },
    ],
  }),
  component: Home,
});

function fmtDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === y.toDateString();
  if (isToday) return "Today";
  if (isYest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Home() {
  const [openStart, setOpenStart] = useState(false);
  const router = useRouter();
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);
  const exercises = useStore((s) => s.exercises);

  const history = useMemo(() => {
    return [...sessions]
      .filter((s) => s.endedAt)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .map((s) => {
        const slot = slots.find((sl) => sl.id === s.splitSlotId);
        const inSess = sets.filter((x) => x.sessionId === s.id);
        const exNames = Array.from(
          new Set(
            inSess.map((x) => exercises.find((e) => e.id === x.exerciseId)?.name).filter(Boolean),
          ),
        );
        return {
          session: s,
          slotName: slot?.name ?? "Untitled",
          setCount: inSess.length,
          exercises: exNames as string[],
        };
      });
  }, [sessions, slots, sets, exercises]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[34px] font-semibold leading-none tracking-tight">Log</h1>
      </header>

      <div className="px-5 anim-fade-up">
        {activeSessionId ? (
          <button
            onClick={() => router.navigate({ to: "/workout" })}
            className="flex w-full items-center justify-between rounded-2xl bg-accent px-5 py-4 text-accent-foreground"
          >
            <span className="text-[16px] font-semibold">Return to workout</span>
            <span className="text-[13px] opacity-90">In progress →</span>
          </button>
        ) : (
          <button
            onClick={() => setOpenStart(true)}
            className="w-full rounded-2xl bg-accent py-5 text-[18px] font-semibold text-accent-foreground"
          >
            Start Workout
          </button>
        )}
      </div>

      <section className="mt-9">
        <div className="flex items-baseline justify-between px-5 pb-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </h2>
          <div className="flex items-baseline gap-3">
            <span className="text-[12px] text-muted-foreground">{history.length} sessions</span>
            <Link to="/calendar" className="text-[12px] font-semibold text-accent">
              Calendar
            </Link>
          </div>
        </div>

        {history.length === 0 && (
          <div className="mx-5 rounded-xl bg-muted px-4 py-8 text-center text-[14px] text-muted-foreground">
            Nothing logged yet.
          </div>
        )}

        <ul className="space-y-3 px-5">
          {history.map(({ session, slotName, setCount, exercises: exNames }, i) => (
            <HistoryCard
              key={session.id}
              sessionId={session.id}
              slotName={slotName}
              setCount={setCount}
              exNames={exNames}
              dateLabel={fmtDate(session.endedAt!)}
              delayMs={Math.min(i, 6) * 35}
            />
          ))}
        </ul>
      </section>

      <StartWorkoutSheet
        open={openStart}
        onClose={() => setOpenStart(false)}
        onStart={() => {
          setOpenStart(false);
          router.navigate({ to: "/workout" });
        }}
      />
    </AppShell>
  );
}

/**
 * A history row that opens the session on tap, and reveals a red delete button
 * on the left when swiped right (iOS-style). Marked `data-swipe-ignore` so the
 * AppShell's between-tabs swipe never fires from a card gesture. The reveal is
 * right-only, which also can't collide with tab-swipe (Home is the first tab,
 * so swipe-right there is already a tab no-op).
 */
function HistoryCard({
  sessionId,
  slotName,
  setCount,
  exNames,
  dateLabel,
  delayMs,
}: {
  sessionId: string;
  slotName: string;
  setCount: number;
  exNames: string[];
  dateLabel: string;
  delayMs: number;
}) {
  const router = useRouter();
  const deleteSession = useStore((s) => s.deleteSession);
  const [dx, setDx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const OPEN = 76;

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiping.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const dxRaw = e.touches[0].clientX - start.current.x;
    const dyRaw = e.touches[0].clientY - start.current.y;
    if (!swiping.current && Math.abs(dxRaw) > Math.abs(dyRaw) && Math.abs(dxRaw) > 8) {
      swiping.current = true;
    }
    if (!swiping.current) return;
    const base = revealed ? OPEN : 0;
    setDx(Math.max(0, Math.min(OPEN + 16, base + dxRaw)));
  };
  const onTouchEnd = () => {
    start.current = null;
    if (dx > OPEN / 2) {
      setRevealed(true);
      setDx(OPEN);
    } else {
      setRevealed(false);
      setDx(0);
    }
  };

  const handleTap = () => {
    if (swiping.current) return; // ignore the click that ends a swipe
    if (revealed) {
      setRevealed(false);
      setDx(0);
      return;
    }
    router.navigate({ to: "/session/$id", params: { id: sessionId } });
  };

  return (
    <li data-swipe-ignore className="anim-fade-up" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="relative overflow-hidden rounded-2xl">
        <button
          aria-label="Delete workout"
          onClick={() => deleteSession(sessionId)}
          className="absolute inset-y-0 left-0 flex w-[76px] items-center justify-center bg-destructive text-white"
        >
          <Trash2 size={20} />
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={handleTap}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="relative flex cursor-pointer items-center justify-between bg-surface px-5 py-4"
          style={{
            transform: `translateX(${dx}px)`,
            transition: start.current ? "none" : "transform 0.22s cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          <div className="min-w-0 flex-1 pr-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[16px] font-semibold tracking-tight">{slotName}</span>
              <span className="text-[12px] text-muted-foreground">· {setCount} sets</span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {exNames.slice(0, 4).join(" · ")}
              {exNames.length > 4 ? " · …" : ""}
            </p>
          </div>
          <span className="text-[12px] text-muted-foreground">{dateLabel}</span>
        </div>
      </div>
    </li>
  );
}
