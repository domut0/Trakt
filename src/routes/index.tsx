import { createFileRoute, useRouter } from "@tanstack/react-router";
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

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" });
}

function isSameLocalDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function Home() {
  const [openStart, setOpenStart] = useState(false);
  const router = useRouter();
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);

  const todaysSessions = useMemo(() => {
    const now = new Date();
    return [...sessions]
      .filter((s) => s.endedAt && isSameLocalDay(new Date(s.endedAt), now))
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .map((s) => {
        const slot = slots.find((sl) => sl.id === s.splitSlotId);
        return {
          session: s,
          slotName: slot?.name ?? "Untitled",
          setCount: sets.filter((x) => x.sessionId === s.id).length,
        };
      });
  }, [sessions, slots, sets]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[34px] font-semibold leading-none tracking-tight">Today</h1>
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

      {/* Placeholder: a later slice renders a day-stats card here (volume,
          sets, streak, etc. for today). No data model for it yet. */}

      {todaysSessions.length > 0 && (
        <div className="mt-6 px-5 anim-fade-up">
          <ul className="space-y-3">
            {todaysSessions.map(({ session, slotName, setCount }) => (
              <li key={session.id}>
                <button
                  onClick={() =>
                    router.navigate({ to: "/session/$id", params: { id: session.id } })
                  }
                  className="flex w-full items-center justify-between rounded-2xl bg-surface px-5 py-4 text-left"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tracking-tight">{slotName}</span>
                      <span className="text-[12px] text-muted-foreground">· {setCount} sets</span>
                    </div>
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    {fmtTime(session.endedAt!)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
