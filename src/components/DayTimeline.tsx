import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Activity, Dumbbell, Utensils } from "lucide-react";
import { dayKey } from "../lib/daily-log";
import { useStore } from "../lib/store";
import {
  buildTimelineBands,
  canvasHeightPx,
  heightPx,
  initialScrollPx,
  isTimelineEmpty,
  minutesOfDay,
  offsetPx,
  type TimelineBand,
} from "../lib/timeline";

const PX_PER_HOUR = 56;
const HOURS_IN_DAY = 24;

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function BandIcon({ kind }: { kind: TimelineBand["kind"] }) {
  if (kind === "meal") {
    return <Utensils className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (kind === "strength") {
    return <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  return <Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function DayTimeline(props: {
  date: string;
  onOpenMeal: (mealId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenPlan: () => void;
}): JSX.Element {
  const { date, onOpenMeal, onOpenSession, onOpenPlan } = props;

  // Meal zones are the food half of the intent layer, so they follow the food
  // toggle. With food off, the timeline is a training timeline and drawing six
  // dashed windows for a feature the user has switched off would be the app
  // arguing with a setting.
  const allMeals = useStore((s) => s.meals);
  const foodEnabled = useStore((s) => s.foodEnabled);
  const meals = useMemo(() => (foodEnabled ? allMeals : []), [foodEnabled, allMeals]);
  const foodEntries = useStore((s) => s.foodEntries);
  const sessions = useStore((s) => s.sessions);
  const sets = useStore((s) => s.sets);
  const exercises = useStore((s) => s.exercises);
  const slots = useStore((s) => s.slots);
  const unit = useStore((s) => s.unit);
  const plannedWorkoutForDate = useStore((s) => s.plannedWorkoutForDate);

  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const planned = plannedWorkoutForDate(date);

  const bands = useMemo(() => {
    return buildTimelineBands({
      date,
      now,
      meals,
      foodEntries,
      sessions,
      sets,
      exercises,
      slots,
      planned,
      unit,
    });
  }, [date, now, meals, foodEntries, sessions, sets, exercises, slots, planned, unit]);

  const isEmpty = isTimelineEmpty(bands);
  const isToday = date === dayKey(now);
  const nowMinutes = minutesOfDay(now);

  /**
   * Scroll to the interesting part of the day, on mount and whenever the date
   * changes. Deliberately NOT on `bands`.
   *
   * `bands` is rebuilt every time the clock ticks, because an unfinished
   * session runs to now. Depending on it would re-run this effect once a
   * minute and snap the canvas back under the user's thumb while they were
   * reading the evening. The lint rule is right that the dependency is
   * missing and wrong about what should happen next.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const viewportPx = el.clientHeight || 420;
    el.scrollTop = initialScrollPx(bands, date, new Date(), PX_PER_HOUR, viewportPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const handleBandClick = (band: TimelineBand) => {
    if (band.layer === "zone" && band.mealId) {
      onOpenMeal(band.mealId);
    } else if (band.layer === "block") {
      if (band.state === "actual" && band.sessionId) {
        onOpenSession(band.sessionId);
      } else if (band.state === "planned") {
        onOpenPlan();
      }
    }
  };

  const hours = useMemo(() => Array.from({ length: HOURS_IN_DAY }, (_, i) => i), []);

  return (
    <div className="group-list relative h-[420px] bg-surface">
      <div
        ref={scrollRef}
        className="relative h-full w-full overflow-y-auto"
        style={{ overscrollBehaviorY: "contain" }}
        data-testid="timeline-scroll-container"
      >
        <div className="relative w-full" style={{ height: `${canvasHeightPx(PX_PER_HOUR)}px` }}>
          {/* Hour rules and hour labels */}
          {hours.map((h) => {
            const top = offsetPx(h * 60, PX_PER_HOUR);
            return (
              <div
                key={`hour-${h}`}
                className="pointer-events-none absolute left-0 right-0"
                style={{ top: `${top}px` }}
              >
                <div className="absolute left-0 w-14 pr-2 text-right t-caption text-muted-foreground -translate-y-1/2 select-none">
                  {formatHour(h)}
                </div>
                <div className="absolute left-14 right-0 h-px bg-border" />
              </div>
            );
          })}

          {/*
            The note, not the empty state. The dashed intent bands below still
            draw on a day nothing has happened on, because that is the day they
            are most worth seeing: a fresh morning with the now line above an
            untouched breakfast window is the whole feature. This line only says
            that none of it has been filled in yet.
          */}
          {isEmpty && (
            <div className="pointer-events-none absolute left-16 top-4 z-10 t-label text-muted-foreground select-none">
              {date < dayKey(now) ? "This one went unrecorded." : "Still ahead of you."}
            </div>
          )}

          {/* Bands layer. Always rendered, empty day or not: see the note above. */}
          <div className="absolute inset-y-0 left-14 right-3 pointer-events-none">
            {bands.map((band) => {
              const top = offsetPx(band.fromMinutes, PX_PER_HOUR);
              const height = heightPx(band, PX_PER_HOUR);
              const isPlanned = band.state === "planned";
              const isBlock = band.layer === "block";

              return (
                <button
                  key={band.id}
                  type="button"
                  onClick={() => handleBandClick(band)}
                  aria-label={`${band.label}${band.detail ? `, ${band.detail}` : ""}`}
                  className={`pointer-events-auto absolute flex items-center gap-2 overflow-hidden px-3 text-left transition-opacity hover:opacity-90 active:opacity-75 ${
                    isBlock ? "left-5 right-0 z-20" : "left-0 right-0 z-10"
                  } ${
                    isPlanned ? "border border-dashed border-border bg-transparent" : "bg-muted"
                  } ${band.openEnded ? "rounded-t-xl rounded-b-none border-b-0" : "rounded-xl"}`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                  }}
                >
                  <BandIcon kind={band.kind} />
                  <span className="truncate t-body font-medium text-foreground">{band.label}</span>
                  {band.detail && (
                    <span className="truncate t-label text-muted-foreground">{band.detail}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Now line rendered on today only */}
          {isToday && (
            <div
              data-testid="now-line"
              className="pointer-events-none absolute left-0 right-0 z-30 flex items-center -translate-y-1/2"
              style={{ top: `${offsetPx(nowMinutes, PX_PER_HOUR)}px` }}
            >
              <div className="flex shrink-0 items-center justify-center rounded-md bg-accent px-2 py-1 t-caption font-semibold text-accent-foreground">
                {formatTime(nowMinutes)}
              </div>
              <div className="h-px flex-1 bg-accent" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
