import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, isValid } from "date-fns";
import { AppShell } from "../components/AppShell";
import { DayStatsCard } from "../components/DayStatsCard";
import { WeekStrip } from "../components/WeekStrip";
import { CoachPlanCard } from "../components/CoachPlanPrompt";
import { dayKey, isDailyLogEmpty, parseDayKey } from "../lib/daily-log";
import { useStore, type DailyLog } from "../lib/store";

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
      { title: "Trakt" },
      {
        name: "description",
        content: "Today at a glance: morning bodyweight, and the day's calories and macros.",
      },
      { property: "og:title", content: "Trakt" },
      {
        property: "og:description",
        content: "Today at a glance: morning bodyweight, and the day's calories and macros.",
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

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const selected = date ?? todayKey;

  const upsertDailyLog = useStore((s) => s.upsertDailyLog);
  // The projection, not the raw table: a day logged purely through food entries
  // has no typed macros, so reading s.dailyLogs here would report it as
  // untracked while the stats card directly above showed its calories.
  const dailyLogs = useStore((s) => s.dailyLogs);

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
   *
   * NOT on a future day. It is a backfill tool, and offering to write today's
   * macros into tomorrow contradicts the stats card directly above it, which
   * deliberately shows a future day its targets and no values at all.
   */
  const canCopyPrevious =
    selected <= todayKey &&
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

  /**
   * The page's own name, always the date.
   *
   * This used to read "Today" on today, which is the one day the screen does
   * not need to be told about: the week strip immediately below already inks
   * the column you are on, so the largest word on the screen was restating the
   * thing directly under it and spending the margin on nothing. A timetable
   * names its page with the date it covers.
   */
  // A full weekday, then the month before the day: "Sunday, September 13".
  // The timetable this inherited from set it in tracked caps as an abbreviated
  // departure ("THU 20 AUG"), and the first pass off that kept its day-month
  // order. The calendar's day panel has always said "Thursday, August 20", so
  // the two screens were naming the same date two different ways.
  const heading = format(parseDayKey(selected), "EEEE, MMMM d");

  return (
    <AppShell>
      <header className="pl-4 pr-12 pt-14 pb-2">
        <h1 className="t-title">{heading}</h1>
      </header>

      {/* First thing on the screen people open the app to. Renders nothing
          unless a coach plan is waiting. */}
      <CoachPlanCard />

      <div className="px-4">
        <WeekStrip selectedDate={selected} onSelectDate={selectDate} />
      </div>

      {/*
        The day is named, the week picks it, and the numbers for it follow.

        Nothing else is on this screen. Workouts live on History and Plan, and
        the 24-hour day timeline that used to sit here was the one thing the
        user asked for by name to remove: it was a thing you looked AT rather
        than a thing you used, in an app whose two daily visits are both
        entry - one-handed mid-set, and half-asleep in bed.
      */}
      <section className="px-4 pt-4">
        {/* The card IS the editor. It used to be a readout wrapped in a button
            that opened a sheet holding the same six fields against the same
            targets - so the sheet's whole contribution was a Save button and a
            second copy of the screen behind it. Typing here writes straight
            through. */}
        <div className="group-header">
          <h2 className="t-caption">Daily numbers</h2>
        </div>
        <DayStatsCard date={selected} editable />

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
            className="mt-3 flex min-h-[44px] w-full items-center justify-between rounded-lg bg-surface px-4 text-left transition-colors active:opacity-70"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3 pr-3">
              <span className="shrink-0 t-action t-label">Copy the day before</span>
              <span className="truncate t-label text-ink-2">
                {formatPreviousSummary(previousLog)}
              </span>
            </span>
            <span className="shrink-0 t-action t-label">Copy</span>
          </button>
        )}
      </section>

      <div className="pb-8" />
    </AppShell>
  );
}
