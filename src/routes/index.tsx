import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayEditorSheet } from "../components/DayEditorSheet";
import { StartWorkoutSheet } from "../components/StartWorkoutSheet";
import { dayKey } from "../lib/daily-log";
import { useStore, type DailyLog } from "../lib/store";

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
  const [openDayEditor, setOpenDayEditor] = useState(false);
  const router = useRouter();
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const todayLog = dailyLogs.find((l) => l.date === todayKey);

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

      <div className="mt-6 px-5 anim-fade-up">
        <button
          onClick={() => setOpenDayEditor(true)}
          className="w-full rounded-2xl bg-surface px-5 py-4 text-left"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[16px] font-semibold tracking-tight">Daily log</span>
            <span className="text-[13px] font-medium text-accent">{todayLog ? "Edit" : "Add"}</span>
          </div>
          {todayLog ? (
            <DayLogSummary log={todayLog} unit={unit} />
          ) : (
            <div className="mt-1 text-[13px] text-muted-foreground">
              Nothing logged today. Tap to add calories, macros, steps or bodyweight.
            </div>
          )}
        </button>
      </div>

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

      <DayEditorSheet
        date={todayKey}
        open={openDayEditor}
        onClose={() => setOpenDayEditor(false)}
      />
    </AppShell>
  );
}

/** Compact read-only view of a day's numbers. Only shows what was actually
 * logged, so a bodyweight-only day reads as one clean stat instead of a grid
 * of blanks. */
function DayLogSummary({ log, unit }: { log: DailyLog; unit: "lbs" | "kg" }) {
  const stats: { label: string; value: string }[] = [];
  if (log.calories !== undefined) stats.push({ label: "kcal", value: String(log.calories) });
  if (log.protein !== undefined) stats.push({ label: "P", value: `${log.protein}g` });
  if (log.carbs !== undefined) stats.push({ label: "C", value: `${log.carbs}g` });
  if (log.fat !== undefined) stats.push({ label: "F", value: `${log.fat}g` });
  if (log.steps !== undefined) stats.push({ label: "steps", value: log.steps.toLocaleString() });
  if (log.bodyweight !== undefined) stats.push({ label: unit, value: String(log.bodyweight) });

  return (
    <div className="mt-2">
      {stats.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {stats.map((s) => (
            <span key={s.label} className="text-[15px]">
              <span className="tnum font-semibold">{s.value}</span>{" "}
              <span className="text-[12px] text-muted-foreground">{s.label}</span>
            </span>
          ))}
        </div>
      )}
      {log.isCheatDay && (
        <div className={"text-[12px] text-muted-foreground" + (stats.length > 0 ? " mt-1.5" : "")}>
          Cheat day
        </div>
      )}
    </div>
  );
}
