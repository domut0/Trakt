import { useMemo, useState, type JSX } from "react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, parseDayKey } from "../lib/daily-log";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/**
 * The week, as a timetable's column header.
 *
 * A schedule names its columns across the top and rules between them, and the
 * day you are reading is the column you are in. So the selected day is not a
 * circle floating in a row of circles: it is an inked column, knocked out in
 * paper, running the full height of the band. That is the same information in
 * the form the rest of the page is already speaking.
 *
 * Today, when it is not the selected day, takes a rule under its figure rather
 * than a second fill. Two filled things would be two selections.
 *
 * Layout note: this does NOT use `group-list`. That utility bleeds itself to
 * the trim with a negative inline margin on the assumption it sits inside the
 * page's `px-5`, and the strip is rendered by the day view at the top level
 * with no gutter around it, so it inherited a 40px overhang off both edges.
 * The rules here bleed because the element is already full width, and the
 * gutter is put back on the chevrons.
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
    <div className="rule-heavy-t rule-b flex items-stretch">
      <button
        type="button"
        onClick={handlePrevWeek}
        aria-label="Previous week"
        className="flex w-10 shrink-0 items-center justify-center text-ink-2 active:bg-wash"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="grid flex-1 grid-cols-7">
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
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 border-l border-rule focus:outline-none ${
                isSelected ? "bg-ink text-paper" : "text-ink active:bg-wash"
              }`}
            >
              <span className={`t-caption ${isSelected ? "text-paper" : "text-ink-3"}`}>
                {WEEKDAY_INITIALS[idx]}
              </span>
              <span
                className={`t-body font-bold tnum ${
                  // Today, unselected, is underscored rather than filled. It is
                  // a landmark in the week, not a second selection.
                  !isSelected && isTodayDay ? "border-b-2 border-ink leading-none" : ""
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleNextWeek}
        aria-label="Next week"
        className="flex w-10 shrink-0 items-center justify-center border-l border-rule text-ink-2 active:bg-wash"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
