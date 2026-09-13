import { useMemo, useState, type JSX } from "react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { Chevron, ChevronLeft } from "./icons";
import { dayKey, parseDayKey } from "../lib/daily-log";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/**
 * The week, as seven things you can tap.
 *
 * This was a timetable's column header: the selected day drawn as an inked
 * column knocked out in paper, running the full height of a band that bled to
 * the trim, with a hairline ruled between every day. Every part of that was
 * the old world talking - the rules, the bleed, and the idea that a selection
 * is a filled column rather than a selected thing.
 *
 * It is now what it always was: a segmented control. The selected day is a
 * rounded fill, and nothing is ruled, because seven evenly spaced cells are
 * already legible as seven cells.
 *
 * Today, when it is NOT the selected day, takes a dot beneath its figure
 * rather than a second fill. Two filled things would read as two selections,
 * which is the one thing this control must never say.
 */
export function WeekStrip({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}): JSX.Element {
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate);
  const [viewedDate, setViewedDate] = useState(() => parseDayKey(selectedDate));

  if (prevSelectedDate !== selectedDate) {
    setPrevSelectedDate(selectedDate);
    setViewedDate(parseDayKey(selectedDate));
  }

  const weekStart = useMemo(() => startOfWeek(viewedDate, { weekStartsOn: 0 }), [viewedDate]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const todayKey = dayKey(new Date());

  const handlePrevWeek = () => {
    setViewedDate((d) => subWeeks(d, 1));
  };

  const handleNextWeek = () => {
    setViewedDate((d) => addWeeks(d, 1));
  };

  /*
    No month caption and no Today button.

    The screen title directly above already names the day, so a month label
    under it made the header two competing texts, and the strip is a week: the
    dates in it say which month it is. Returning to today is the bottom nav's
    Today tab, which navigates to bare `/` and clears the date param, so a
    second control for it inside the strip was a duplicate of something more
    discoverable.
  */
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={handlePrevWeek}
        aria-label="Previous week"
        className="flex w-8 shrink-0 items-center justify-center rounded-md text-ink-3 active:bg-wash"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((day, idx) => {
          const key = dayKey(day);
          const isSelected = key === selectedDate;
          const isTodayDay = key === todayKey;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              aria-pressed={isSelected}
              aria-label={format(day, "EEEE, MMMM d, yyyy")}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-md focus:outline-none ${
                isSelected ? "bg-ink text-paper" : "text-ink active:bg-wash"
              }`}
            >
              <span className={`t-label ${isSelected ? "text-paper" : "text-ink-3"}`}>
                {WEEKDAY_INITIALS[idx]}
              </span>
              <span className="t-body font-semibold tnum leading-none">{day.getDate()}</span>
              {/* Always rendered, so the row cannot reflow by 4px as the dot
                  appears and disappears while you page between weeks. */}
              <span
                aria-hidden="true"
                className={`h-1 w-1 rounded-full ${
                  isTodayDay ? (isSelected ? "bg-paper" : "bg-ink") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleNextWeek}
        aria-label="Next week"
        className="flex w-8 shrink-0 items-center justify-center rounded-md text-ink-3 active:bg-wash"
      >
        <Chevron size={16} />
      </button>
    </div>
  );
}
