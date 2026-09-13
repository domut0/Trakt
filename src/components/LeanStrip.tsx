import { useEffect, useMemo, useRef } from "react";
import { dayKey } from "../lib/daily-log";
import { addDaysToKey, daysBetweenKeys, isUntrackedOn, targetsForDate } from "../lib/planning";
import { useStore } from "../lib/store";

/** How far back the strip can be scrolled. */
const MAX_DAYS = 90;
/** The shortest strip drawn, so a new account does not get a stub. */
const MIN_DAYS = 14;
/** Pixels from the centre line to a target line. A day that lands exactly on
 *  target reaches it. */
const ON_TARGET = 34;
/** Everything past this multiple of target is drawn at the same length. The
 *  difference between 1.8x and 2.4x of a step goal is not something the shape
 *  needs to resolve, and letting it run makes every other day unreadable. */
const CAP = 1.5;
/** One day's slot, and the mark inside it. */
const COL = 14;
const BAR = 6;

/**
 * Two opposed quantities per day, each against the line it is aiming at.
 *
 *   A CENTRE LINE IS THE DAY.
 *   Calories rise from it, as a fraction of that day's calorie target.
 *   Steps fall from it, as a fraction of that day's step target.
 *   A SOLID LINE EITHER SIDE IS THE TARGET, at exactly 1x.
 *
 * The target lines are what make this readable with no caption under it.
 * Calories are a ceiling, so a day that stops short of the upper line went
 * well; steps are a floor, so a day that pushes past the lower line went well.
 * Both good outcomes tilt the mark the same way - which is the whole design,
 * and the thing the version before it had backwards: there the step band grew
 * upward from a floor, so walking further CLOSED the gap it was meant to open.
 *
 * Because each half is a fraction of ITS OWN target, one flat line serves every
 * phase: a 2,400 kcal cut and a 2,700 kcal maintenance put their target at the
 * same height, so a change-point does not move the reference. Nothing is
 * converted between the two - the app has no TDEE and must not imply one.
 */
export function LeanStrip() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const phases = useStore((s) => s.nutritionPhases);
  const hydrated = useStore((s) => s.hydrated);

  const scroller = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const today = dayKey(new Date());
    const earliest = dailyLogs.reduce<string | undefined>(
      (min, l) => (min === undefined || l.date < min ? l.date : min),
      undefined,
    );
    // As far back as there is something to draw, and no further: a fixed window
    // opens on empty columns for anyone who started last week.
    const span = earliest ? daysBetweenKeys(earliest, today) + 1 : MIN_DAYS;
    const count = Math.min(MAX_DAYS, Math.max(MIN_DAYS, span));
    return Array.from({ length: count }, (_, i) => {
      const date = addDaysToKey(today, i - (count - 1));
      const log = dailyLogs.find((l) => l.date === date);
      const target = targetsForDate(phases, date);
      const untracked = isUntrackedOn(phases, date, log?.isUntracked);
      const ratio = (v: number | undefined, t: number | undefined) =>
        v === undefined || t === undefined || t <= 0 ? undefined : Math.min(CAP, v / t);
      return {
        date,
        untracked,
        cals: untracked ? undefined : ratio(log?.calories, target?.calories),
        steps: untracked ? undefined : ratio(log?.steps, target?.steps),
      };
    });
  }, [dailyLogs, phases]);

  // Opens at the right-hand end, because the most recent day is the one being
  // read and everything else is history you scroll back into.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length]);

  if (!hydrated) return null;

  const half = ON_TARGET * CAP;
  const boxHeight = half * 2 + 1;

  return (
    <section className="px-4 section-gap anim-fade-up">
      <div className="group-header">
        <h2 className="t-caption">Against target</h2>
      </div>

      <div className="flex group-list py-4">
        {/* A fixed gutter, outside the scroller, so the axis stays named
            however far back you scroll. */}
        <div className="relative w-11 shrink-0" style={{ height: boxHeight }} aria-hidden="true">
          <span
            className="absolute right-2 t-label text-ink-2"
            style={{ top: half - ON_TARGET - 7, fontSize: 11 }}
          >
            cals
          </span>
          <span
            className="absolute right-2 t-label text-ink-2"
            style={{ top: half + ON_TARGET - 7, fontSize: 11 }}
          >
            steps
          </span>
        </div>

        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pr-3">
          <div className="relative" style={{ width: days.length * COL, height: boxHeight }}>
            {/* The two targets, and the day between them. */}
            <div
              className="absolute inset-x-0 h-px bg-ink-2"
              style={{ top: half - ON_TARGET }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-x-0 h-px bg-ink-2"
              style={{ top: half + ON_TARGET }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-x-0 h-px bg-wash"
              style={{ top: half }}
              aria-hidden="true"
            />

            {days.map((d, i) => (
              <div
                key={d.date}
                className="absolute top-0"
                style={{ left: i * COL + (COL - BAR) / 2, width: BAR, height: boxHeight }}
              >
                {d.cals !== undefined && (
                  <div
                    className="absolute w-full bg-ink-3"
                    style={{
                      bottom: half + 1,
                      height: Math.max(2, d.cals * ON_TARGET),
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                {d.steps !== undefined && (
                  <div
                    className="absolute w-full bg-ink"
                    style={{
                      top: half + 1,
                      height: Math.max(2, d.steps * ON_TARGET),
                      borderRadius: "0 0 2px 2px",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
