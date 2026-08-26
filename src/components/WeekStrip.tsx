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
  const displayedKeys = useMemo(() => days.map((d) => dayKey(d)), [days]);
  const weekContainsToday = displayedKeys.includes(todayKey);
  const isSelectedToday = selectedDate === todayKey;
  const showToday = !weekContainsToday || !isSelectedToday;

  const monthLabel = format(weekStart, "MMMM yyyy");

  const handlePrevWeek = () => {
    setViewedDate((d) => subWeeks(d, 1));
  };

  const handleNextWeek = () => {
    setViewedDate((d) => addWeeks(d, 1));
  };

  const handleToday = () => {
    const todayStr = dayKey(new Date());
    setViewedDate(parseDayKey(todayStr));
    onSelectDate(todayStr);
  };

  return (
    <div className="group-list p-4">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="t-body font-semibold tracking-tight text-foreground">
            {monthLabel}
          </span>
          {showToday && (
            <button
              type="button"
              onClick={handleToday}
              className="flex min-h-[44px] items-center px-2 t-label font-medium text-accent hover:text-foreground"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevWeek}
            aria-label="Previous week"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleNextWeek}
            aria-label="Next week"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
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
    </div>
  );
}
