import { useMemo, useState, type JSX } from "react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, parseDayKey } from "../lib/daily-log";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

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

  return (
    /*
      No month caption and no Today button.

      The screen title directly above already names the day, so a month label
      under it made the header two competing texts, and the strip is a week: the
      dates in it say which month it is. Returning to today is the bottom nav's
      Today tab, which navigates to bare `/` and clears the date param, so a
      second control for it inside the strip was a duplicate of something more
      discoverable.

      That leaves the chevrons flanking the week rather than sitting in a header
      row of their own, which is what the header row existed to hold.
    */
    <div className="group-list flex items-center gap-1 p-4">
      <button
        type="button"
        onClick={handlePrevWeek}
        aria-label="Previous week"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="grid flex-1 grid-cols-7 gap-1 text-center">
        {days.map((day, idx) => {
          const key = dayKey(day);
          const isSelected = key === selectedDate;
          const isTodayDay = key === todayKey;
          const dateNum = day.getDate();

          let numStyle = "text-foreground";
          if (isSelected) {
            numStyle = "bg-accent text-accent-foreground";
          } else if (isTodayDay) {
            numStyle = "text-accent";
          }

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              aria-pressed={isSelected}
              aria-label={format(day, "EEEE, MMMM d, yyyy")}
              className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 transition-colors hover:bg-muted focus:outline-none"
            >
              <span className="t-caption text-muted-foreground">{WEEKDAY_INITIALS[idx]}</span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full t-body font-semibold tnum ${numStyle}`}
              >
                {dateNum}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleNextWeek}
        aria-label="Next week"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
