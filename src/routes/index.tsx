import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { format, isValid } from "date-fns";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayEditorSheet } from "../components/DayEditorSheet";
import { DayStatsCard } from "../components/DayStatsCard";
import { DayTimeline } from "../components/DayTimeline";
import { HabitsCard } from "../components/HabitsCard";
import { MealSheet } from "../components/MealSheet";
import { WeekStrip } from "../components/WeekStrip";
import { dayKey, isDailyLogEmpty, parseDayKey } from "../lib/daily-log";
import { useStore, type DailyLog } from "../lib/store";
import { useEffectiveDailyLogs } from "../lib/use-day-macros";

/**
 * The day view. One date, three cards: a week strip that moves it, a stats card
 * summarising it, and a timeline showing what was intended against what actually
 * happened. See `docs/home-screen-plan.md`.
 */
export const Route = createFileRoute("/")({
  /**
   * The selected day, as a local "yyyy-MM-dd" key. Absent means today.
   *
   * Anything unparseable resolves to today rather than throwing: this is the
   * app's home screen and a hand-mangled URL must not be able to show the user
   * an error page. `validateSearch` therefore normalises rather than rejects.
   */
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = search.date;
    if (typeof raw !== "string" || !isValid(parseDayKey(raw))) return {};
    return { date: raw };
  },
  head: () => ({
    meta: [
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "Your whole day on one timeline. What you planned to eat and train, against what you actually did.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "Your whole day on one timeline. What you planned to eat and train, against what you actually did.",
      },
    ],
  }),
  component: Home,
});

/** The day before `key`, as a day key. Built through a Date so month and year
 * boundaries and DST are the platform's problem rather than string arithmetic. */
function previousDayKey(key: string): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

function formatPreviousSummary(log: DailyLog): string {
  const parts: string[] = [];
  if (log.calories !== undefined) parts.push(`${log.calories.toLocaleString()} cal`);
  if (log.protein !== undefined) parts.push(`${log.protein}g P`);
  if (log.carbs !== undefined) parts.push(`${log.carbs}g C`);
  if (log.fat !== undefined) parts.push(`${log.fat}g F`);
  return parts.join(" · ");
}

function Home() {
  const { date } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const router = useRouter();

  const [editorOpen, setEditorOpen] = useState(false);
  const [openMealId, setOpenMealId] = useState<string | null>(null);

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const selected = date ?? todayKey;

  const habitsEnabled = useStore((s) => s.habitsEnabled);
  const upsertDailyLog = useStore((s) => s.upsertDailyLog);
  // The projection, not the raw table: a day logged purely through food entries
  // has no typed macros, so reading s.dailyLogs here would report it as
  // untracked while the stats card directly above showed its calories.
  const dailyLogs = useEffectiveDailyLogs();

  const selectedLog = dailyLogs.find((l) => l.date === selected);
  const previousKey = previousDayKey(selected);
  const previousLog = dailyLogs.find((l) => l.date === previousKey && !isDailyLogEmpty(l));

  /**
   * The backfill shortcut, kept from the old Today screen but generalised.
   *
   * It used to be "copy yesterday" and only ever ran on today. Now that the
   * screen has a date, it copies the day BEFORE whichever day you are looking
   * at, which is the same idea and works while backfilling a gap. It appears
   * only when this day has nothing and the one before it has something, so it
   * can never overwrite anything.
   */
  const canCopyPrevious =
    (selectedLog === undefined || isDailyLogEmpty(selectedLog)) &&
    previousLog !== undefined &&
    (previousLog.calories !== undefined ||
      previousLog.protein !== undefined ||
      previousLog.carbs !== undefined ||
      previousLog.fat !== undefined);

  /**
   * `replace`, never push. Tapping through a week would otherwise leave seven
   * history entries behind it, so the back gesture would walk the days you just
   * looked at instead of leaving the screen. On a phone where back is an edge
   * swipe, that is the difference between a screen that works and one that
   * feels trapped.
   */
  const selectDate = (next: string) => {
    void navigate({ search: next === todayKey ? {} : { date: next }, replace: true });
  };

  const isToday = selected === todayKey;
  const title = isToday ? "Today" : format(parseDayKey(selected), "EEE d MMM");

  return (
    <AppShell>
      <header className="px-5 pt-14 pb-2">
        <h1 className="t-title">{title}</h1>
      </header>

      <WeekStrip selectedDate={selected} onSelectDate={selectDate} />

      {/*
        Habits stays above the stats card for the reason it always did: it is
        tapped every morning and needs to sit at a stable y-offset, which it
        cannot do below a card whose height changes with how much was logged.

        No HabitEditorSheet here on purpose. HabitsCard owns the sheet and its
        open state internally, so mounting one here too would give the screen a
        second, independent editor.
      */}
      {habitsEnabled && (
        <section className="px-5 section-gap anim-fade-up">
          <h2 className="group-header px-0 t-caption">Habits</h2>
          <HabitsCard date={selected} />
        </section>
      )}

      <section className="px-5 section-gap anim-fade-up">
        <h2 className="group-header px-0 t-caption">Daily numbers</h2>
        {/*
          The card is wrapped rather than given an onEdit prop so that it stays a
          pure readout with one job. Nothing inside it is interactive, so a
          button around the whole thing is unambiguous and gives the 44px hit
          area for free.
        */}
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          aria-label={`Edit daily numbers for ${title}`}
          className="w-full text-left focus:outline-none"
        >
          <DayStatsCard date={selected} />
        </button>

        {canCopyPrevious && (
          <button
            type="button"
            onClick={() =>
              upsertDailyLog(selected, {
                calories: previousLog.calories,
                protein: previousLog.protein,
                carbs: previousLog.carbs,
                fat: previousLog.fat,
              })
            }
            className="mt-3 flex min-h-[44px] w-full items-center justify-between px-5 text-left transition-colors active:opacity-70"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3 pr-3">
              <span className="shrink-0 t-label font-semibold text-accent">
                Copy the day before
              </span>
              <span className="truncate t-label text-muted-foreground">
                {formatPreviousSummary(previousLog)}
              </span>
            </span>
            <span className="shrink-0 t-label font-semibold text-accent">Copy</span>
          </button>
        )}
      </section>

      <section className="px-5 section-gap pb-8 anim-fade-up">
        <h2 className="group-header px-0 t-caption">The day</h2>
        <DayTimeline
          date={selected}
          onOpenMeal={setOpenMealId}
          onOpenSession={(id) => router.navigate({ to: "/session/$id", params: { id } })}
          onOpenPlan={() => router.navigate({ to: "/plan" })}
        />
      </section>

      <MealSheet mealId={openMealId} date={selected} onClose={() => setOpenMealId(null)} />

      <DayEditorSheet date={selected} open={editorOpen} onClose={() => setEditorOpen(false)} />
    </AppShell>
  );
}
