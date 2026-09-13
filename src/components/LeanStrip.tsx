import { useMemo } from "react";
import { dayKey } from "../lib/daily-log";
import { addDaysToKey, isUntrackedOn, targetsForDate } from "../lib/planning";
import { useStore } from "../lib/store";

/** Days drawn. Two weeks fits the width without scrolling and is long enough
 *  for a change-point to sit inside it. */
const DAYS = 14;
/** Pixels a bar reaches when the day landed exactly on target. */
const ON_TARGET = 30;
/** Everything past this multiple of target is drawn at the same length: the
 *  difference between 1.8x and 2.4x of a step goal is not a thing the shape
 *  needs to resolve, and letting it run makes every other day unreadable. */
const CAP = 1.5;

/**
 * Two opposed quantities in one mark, per day.
 *
 *   A CENTRE LINE IS THE DAY.
 *   Calories fill UPWARD from it, as a fraction of that day's calorie target.
 *   Steps fill DOWNWARD from it, as a fraction of that day's step target.
 *
 * Hit both exactly and the mark is symmetric. Eat less and the top shrinks;
 * walk more and the bottom grows - so BOTH improvements tilt the shape the same
 * way, and a good fortnight visibly leans.
 *
 * That sameness is the whole design, and the version before it got it backwards:
 * the step band grew upward from a floor, so walking further CLOSED the gap it
 * was meant to open. Burning more made the picture look like less.
 *
 * Each half is measured against ITS OWN target and never converted into the
 * other's units. The app has no TDEE and cannot compute a deficit, so it draws
 * two ratios and claims nothing about their difference.
 */
export function LeanStrip() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const phases = useStore((s) => s.nutritionPhases);
  const hydrated = useStore((s) => s.hydrated);

  const days = useMemo(() => {
    const today = dayKey(new Date());
    return Array.from({ length: DAYS }, (_, i) => {
      const date = addDaysToKey(today, i - (DAYS - 1));
      const log = dailyLogs.find((l) => l.date === date);
      const target = targetsForDate(phases, date);
      const untracked = isUntrackedOn(phases, date, log?.isUntracked);
      const ratio = (v: number | undefined, t: number | undefined) =>
        v === undefined || t === undefined || t <= 0 ? undefined : Math.min(CAP, v / t);
      return {
        date,
        untracked,
        eaten: untracked ? undefined : ratio(log?.calories, target?.calories),
        walked: untracked ? undefined : ratio(log?.steps, target?.steps),
      };
    });
  }, [dailyLogs, phases]);

  if (!hydrated) return null;

  return (
    <section className="px-4 section-gap anim-fade-up">
      <div className="group-header">
        <h2 className="t-caption">Last 14 days</h2>
        <span className="t-label text-ink-3">eaten above · walked below</span>
      </div>

      <div className="group-list px-3 py-4">
        <div className="flex items-stretch justify-between gap-[3px]">
          {days.map((d) => (
            // Narrow bars, not full-width cells. At a cell's own width the
            // marks were wider than they were tall and read as a row of tiles
            // rather than as two quantities leaning off a line.
            <div key={d.date} className="flex flex-1 flex-col items-center">
              <div className="flex items-end" style={{ height: ON_TARGET * CAP }}>
                {d.eaten !== undefined && (
                  // ink-3 rather than wash: wash sits two steps off the card
                  // behind it and the eaten half simply did not show. The two
                  // halves have to differ from the ground AND from each other.
                  <div
                    className="w-4 bg-ink-3"
                    style={{
                      height: Math.max(2, d.eaten * ON_TARGET),
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
              </div>
              {/* The day itself. Solid where there is something to measure
                  against, hollow where the day was deliberately untracked. */}
              <div className={`h-px w-full ${d.untracked ? "bg-wash" : "bg-rule-strong"}`} />
              <div className="flex items-start" style={{ height: ON_TARGET * CAP }}>
                {d.walked !== undefined && (
                  <div
                    className="w-4 bg-ink"
                    style={{
                      height: Math.max(2, d.walked * ON_TARGET),
                      borderRadius: "0 0 2px 2px",
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* The one sentence this earns: a novel mark has to say where its
            neutral is, or two bars of unknown length is all it is. */}
        <p className="mt-3 t-label text-ink-3">
          Symmetric is on plan · leaning down is ahead of it
        </p>
      </div>
    </section>
  );
}
