import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, isValid } from "date-fns";
import { AppShell } from "../components/AppShell";
import { DayActions } from "../components/DayActions";
import { DaySessionList } from "../components/DaySessionList";
import { DayStatsCard } from "../components/DayStatsCard";
import { WeekStrip } from "../components/WeekStrip";
import { CoachPlanCard } from "../components/CoachPlanPrompt";
import { GettingStartedCard } from "../components/GettingStartedCard";
import { TutorialInstallCard } from "../components/TutorialInstallCard";
import { dayKey, parseDayKey } from "../lib/daily-log";

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

function Home() {
  const { date } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const selected = date ?? todayKey;

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
  // Abbreviated - "Sat 19 Sep" - because this line now shares its row with
  // three icons, and a full "Saturday, September 19" ran underneath them. The
  // calendar's day panel keeps the long form, where it has the width.
  const heading = format(parseDayKey(selected), "EEE d MMM");

  return (
    <AppShell>
      {/* pr-36 clears the three icons the shell puts in this corner on Today:
          History, Charts and Settings. */}
      <header className="pl-4 pr-36 pt-14 pb-2">
        <h1 className="t-title">{heading}</h1>
      </header>

      {/* First thing on the screen people open the app to. Renders nothing
          unless a coach plan is waiting. */}
      <CoachPlanCard />

      {/* The one chapter of the tutorial that needs a control of its own, for
          exactly as long as that chapter runs. */}
      <TutorialInstallCard />
      <GettingStartedCard />

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
        {/* No "Daily numbers" heading. The card is six labelled rows of
            numbers under a date; a caption saying they are numbers was the
            screen narrating itself. */}
        <DayStatsCard date={selected} editable />
        {/* What actually happened today, between the numbers and the way to add
            to them - the same rows the Calendar shows for the day it is on. */}
        <div className="pt-3">
          <DaySessionList date={selected} />
        </div>
        <DayActions date={selected} />
      </section>

      <div className="pb-8" />
    </AppShell>
  );
}
