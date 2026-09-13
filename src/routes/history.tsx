import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { CalendarView } from "../components/CalendarView";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History" },
      { name: "description", content: "Your workouts and daily numbers, day by day." },
      { property: "og:title", content: "History" },
      {
        property: "og:description",
        content: "Your workouts and daily numbers, day by day.",
      },
    ],
  }),
  component: HistoryPage,
});

/**
 * One view, not two.
 *
 * History used to open on a Weekly list with a pill switcher to a Calendar,
 * which is the same hedge the Settings feature toggles were: two answers
 * shipped because nobody would choose one. A month grid answers "did I train,
 * and did I log it" at a glance and lets you reach any day in two taps, which
 * is what this screen is for. The weekly averages the other view carried were
 * a second, quieter product living behind a switch most people never flipped.
 */
function HistoryPage() {
  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="t-title text-ink">History</h1>
      </header>
      <CalendarView />
    </AppShell>
  );
}
