import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { CalendarView } from "../components/CalendarView";
import { WeeklyView } from "../components/WeeklyView";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History" },
      { name: "description", content: "Your workouts and daily numbers, by week or by day." },
      { property: "og:title", content: "History" },
      {
        property: "og:description",
        content: "Your workouts and daily numbers, by week or by day.",
      },
    ],
  }),
  component: HistoryPage,
});

type ViewMode = "weekly" | "calendar";

/**
 * Thin shell: renders the header and Weekly/Calendar switcher, then delegates
 * to WeeklyView or CalendarView. Kept intentionally dumb so later slices can
 * edit one child view without touching the other.
 */
function HistoryPage() {
  const [view, setView] = useState<ViewMode>("weekly");

  return (
    <AppShell>
      <header className="flex items-center justify-between px-5 pb-4 pt-14">
        <h1 className="t-title text-ink">History</h1>
        <div
          data-swipe-ignore
          role="group"
          aria-label="History view"
          className="flex shrink-0 gap-1 bg-wash p-1"
        >
          {/* The pills stay compact so they sit on the same line as the title,
              so the 44px target comes from an inset pseudo-element overlay
              rather than padding. Same trick as the switch in settings.tsx. The
              two overlays only ever extend vertically, and the buttons sit side
              by side, so neither can swallow the other's taps. */}
          <button
            onClick={() => setView("weekly")}
            aria-pressed={view === "weekly"}
            className={
              "relative px-3 py-1.5 t-label font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] " +
              (view === "weekly" ? "bg-ink text-paper" : "text-ink-2")
            }
          >
            Weekly
          </button>
          <button
            onClick={() => setView("calendar")}
            aria-pressed={view === "calendar"}
            className={
              "relative px-3 py-1.5 t-label font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] " +
              (view === "calendar" ? "bg-ink text-paper" : "text-ink-2")
            }
          >
            Calendar
          </button>
        </div>
      </header>

      {view === "weekly" ? <WeeklyView /> : <CalendarView />}
    </AppShell>
  );
}
