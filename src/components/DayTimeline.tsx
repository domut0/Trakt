import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Cardio, Dumbbell, Meal } from "./icons";
import { dayKey } from "../lib/daily-log";
import { useStore } from "../lib/store";
import {
  buildTimelineBands,
  canvasHeightPx,
  formatMinutesOfDay,
  heightPx,
  initialScrollPx,
  minutesOfDay,
  offsetPx,
  type TimelineBand,
} from "../lib/timeline";

const PX_PER_HOUR = 56;
const HOURS_IN_DAY = 24;

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function BandIcon({ kind }: { kind: TimelineBand["kind"] }) {
  if (kind === "meal") {
    return <Meal className="shrink-0 text-ink-2" size={16} />;
  }
  if (kind === "strength") {
    return <Dumbbell className="shrink-0 text-ink-2" size={16} />;
  }
  return <Cardio className="shrink-0 text-ink-2" size={16} />;
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
    const viewportPx = el.clientHeight || 360;
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

  // Split before rendering: an all-day window is not a band on the canvas, it
  // is a chip above it. See the note on TimelineBand.allDay.
  const allDayBands = bands.filter((b) => b.allDay);
  const timedBands = bands.filter((b) => !b.allDay);

  // Deliberately not `group-list`. That utility bleeds itself to the trim with
  // a -20px inline margin, which only works inside the page's px-5 gutter. The
  // day view renders this canvas at the top level with no gutter around it, so
  // group-list would hang it 20px off both edges. The rules are drawn directly
  // here because the element is already full width.
  return (
    <div className="rule-heavy-t rule-b relative flex h-[360px] flex-col">
      {allDayBands.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-3">
          {allDayBands.map((band) => (
            <button
              key={band.id}
              type="button"
              onClick={() => handleBandClick(band)}
              aria-label={`${band.label}${band.detail ? `, ${band.detail}` : ""}`}
              className={`flex min-h-[44px] items-center gap-2 px-3 text-left ${
                band.state === "planned" ? "planned" : "actual"
              }`}
            >
              <BandIcon kind={band.kind} />
              <span className="t-body text-ink">{band.label}</span>
              {band.detail && <span className="t-label text-ink-2">{band.detail}</span>}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="relative min-h-0 w-full flex-1 overflow-y-auto"
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
                {/*
                  Suppressed when the now line is sitting on this hour.

                  Both labels are drawn at left-0 in the same 56px gutter, so at
                  09:12 the black now-line tab landed directly on top of "09:00"
                  and the two read as one smudged token. The line wins: it is
                  the only thing on this canvas that moves, and the hour it
                  covers is the hour it is announcing anyway.
                */}
                {!(isToday && Math.abs(nowMinutes - h * 60) < 18) && (
                  <div className="absolute left-0 w-14 pr-2 text-right t-hour text-ink-3 -translate-y-1/2 select-none">
                    {formatHour(h)}
                  </div>
                )}
                <div className="absolute left-14 right-0 h-px bg-rule" />
              </div>
            );
          })}

          {/* Bands layer. An empty day still draws its dashed intent bands: that is
              the day they are most worth seeing. */}
          <div className="absolute inset-y-0 left-14 right-3 pointer-events-none">
            {timedBands.map((band) => {
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
                  // Two alignment decisions, both from watching it render.
                  //
                  // items-start, not items-center: a six hour breakfast window
                  // centres its label at 08:00, which puts the name of the band
                  // three hours from where the band begins. Calendars label at
                  // the top edge and so does this.
                  //
                  // A ZONE labels to the RIGHT, into a gutter that blocks are
                  // kept out of. Dinner and the workout inside it both start
                  // around 17:00, so with both labelled top-left the block wins
                  // and the window loses its name. Right-aligning alone was not
                  // enough, because a block running to the same right edge
                  // covers that corner too, so blocks stop at right-20 and the
                  // zone owns the 80px beyond it.
                  //
                  // That gutter fits a name but not a name plus a count, which
                  // is why a zone shows no detail on the canvas. It costs
                  // nothing: filled versus dashed already says whether the
                  // window has anything in it, and the count is one tap away.
                  className={`pointer-events-auto absolute flex items-start gap-2 overflow-hidden px-3 py-2 transition-opacity hover:opacity-90 active:opacity-75 ${
                    isBlock ? "left-5 right-20 z-20 text-left" : "left-0 right-0 z-10 justify-end"
                  } ${isPlanned ? "planned" : "actual"} ${
                    // An open-ended band runs off the bottom of its own box, so
                    // it loses the rule that would otherwise claim it ends here.
                    band.openEnded ? "border-b-0" : ""
                  }`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                  }}
                >
                  <BandIcon kind={band.kind} />
                  {/*
                    Stacked, not inline. Once blocks stop at right-20 to leave
                    the zone its gutter, a block on a 375px screen has about
                    140px of content width, and "Heavy Bench" beside "12 sets"
                    truncates both to initials. On two lines the name gets the
                    whole width and the count still fits underneath.
                  */}
                  {/* flex-1 on a BLOCK only. On a zone it would fill the width
                      and undo the justify-end that keeps the name in its
                      gutter, stranding the icon at the far left. */}
                  <span className={`min-w-0 ${isBlock ? "flex-1" : ""}`}>
                    <span className="block truncate t-body text-ink">{band.label}</span>
                    {band.detail && isBlock && (
                      <span className="block truncate t-label text-ink-2">{band.detail}</span>
                    )}
                  </span>
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
              <div className="flex shrink-0 items-center justify-center bg-ink px-1.5 py-0.5 t-caption text-paper">
                {formatMinutesOfDay(nowMinutes)}
              </div>
              <div className="h-0.5 flex-1 bg-ink" />
            </div>
          )}
        </div>
      </div>

      {/*
        No empty state. An untouched day already reads as untouched: the dashed
        intent bands are there with nothing filled in, which says it without a
        sentence. A line of prose on top of that was saying the same thing twice
        and reading as debug text.
      */}
    </div>
  );
}
