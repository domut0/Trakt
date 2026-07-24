import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
            <li key={session.id}>
              <Link
                to="/session/$id"
                params={{ id: session.id }}
                className="flex items-center justify-between rounded-2xl bg-surface px-5 py-4 anim-fade-up"
                style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
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
                <span className="text-[12px] text-muted-foreground">
                  {fmtDate(session.endedAt!)}
                </span>
              </Link>
            </li>
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
