import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { niceCeil } from "../lib/chart-math";
import { dayKey, parseDayKey } from "../lib/daily-log";
import { addDaysToKey, daysBetweenKeys, isUntrackedOn, targetsForDate } from "../lib/planning";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useStore } from "../lib/store";

/** The shortest strip drawn, so a new account gets an axis rather than a stub. */
const MIN_DAYS = 14;
/** Pixels from the centre line to the top (or bottom) of the chart. */
const HALF = 56;
/** One day's slot, and the mark inside it. */
const COL = 14;
const BAR = 6;
/** Axis maxima round up to these, and never fall below them. */
const CAL_STEP = 500;
const STEP_STEP = 2000;

/**
 * Both daily numbers against both daily targets, one column per day.
 *
 *   A CENTRE LINE IS THE DAY.
 *   Calories rise from it, on their own axis.
 *   Steps fall from it, on theirs.
 *   THE TARGET IS A LINE ACROSS EACH HALF, and it is a STAIRCASE, not a rule:
 *   it is drawn per day, so it steps where a phase changes and you can see the
 *   cut start.
 *
 * THE SCALE IS ABSOLUTE, which is the change that makes the rest of it work.
 * The version before this drew each half as a FRACTION of that day's target, so
 * one flat line could serve every phase - elegant, and it meant a day with no
 * target in force had no denominator and therefore no bar at all. Months of
 * real logging showed as blank columns. Here the axis is calories and steps in
 * their own units, taken from the data, so a day draws whatever it has whether
 * or not anything was planned for it.
 *
 * Nothing is converted between the two halves. The app has no TDEE and cannot
 * turn steps into calories, so it draws two quantities and claims nothing about
 * their difference.
 */
export function TargetStrip() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const phases = useStore((s) => s.nutritionPhases);
  const hydrated = useStore((s) => s.hydrated);

  const scroller = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const clearSelected = useCallback(() => setSelected(null), []);

  // The day card has no backdrop, on purpose - the page stays live and
  // scrollable behind it - so the only thing that can notice a press meant for
  // something else is the document. Scoped to the plot rather than the whole
  // card, so a press on another bar still selects that bar rather than being
  // spent closing this one.
  useDismissOnOutside(plot, selected !== null, clearSelected);

  const { days, calMax, stepMax } = useMemo(() => {
    const today = dayKey(new Date());
    const earliest = dailyLogs.reduce<string | undefined>(
      (min, l) => (min === undefined || l.date < min ? l.date : min),
      undefined,
    );
    // Back to the first day ever logged. No window: the whole point of a
    // scrolling chart is that the history is in it, and a fixed 90-day cap was
    // hiding everything before it.
    const span = earliest ? daysBetweenKeys(earliest, today) + 1 : MIN_DAYS;
    const count = Math.max(MIN_DAYS, span);

    const rows = Array.from({ length: count }, (_, i) => {
      const date = addDaysToKey(today, i - (count - 1));
      const log = dailyLogs.find((l) => l.date === date);
      const target = targetsForDate(phases, date);
      return {
        date,
        untracked: isUntrackedOn(phases, date, log?.isUntracked),
        calories: log?.calories,
        steps: log?.steps,
        protein: log?.protein,
        carbs: log?.carbs,
        fat: log?.fat,
        calTarget: target?.calories,
        stepTarget: target?.steps,
      };
    });

    // The axis is sized by everything in it - what was logged AND what was
    // aimed at - so a target always has room to be drawn, even on a stretch
    // where nothing was ever hit.
    const peak = (pick: (r: (typeof rows)[number]) => (number | undefined)[]) =>
      rows.reduce((m, r) => Math.max(m, ...pick(r).map((v) => (v === undefined ? 0 : v))), 0);

    // One step of headroom when the peak lands exactly on a round number,
    // which a step goal usually does. Without it a 20,000 goal puts its own
    // line on the chart's bottom edge, where no day can ever be seen crossing
    // it - and a 20,000-step day draws identically to a 26,000-step one.
    const axisMax = (value: number, step: number, floor: number) => {
      const m = niceCeil(value, step, floor);
      return m === value ? m + step : m;
    };

    return {
      days: rows,
      calMax: axisMax(
        peak((r) => [r.calories, r.calTarget]),
        CAL_STEP,
        2000,
      ),
      stepMax: axisMax(
        peak((r) => [r.steps, r.stepTarget]),
        STEP_STEP,
        10000,
      ),
    };
  }, [dailyLogs, phases]);

  // Opens at the right-hand end, because the most recent day is the one being
  // read and everything before it is history you scroll back into.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length]);

  if (!hydrated) return null;

  const height = HALF * 2 + 1;
  const width = days.length * COL;
  const up = (v: number | undefined, max: number) =>
    v === undefined ? undefined : Math.max(2, Math.min(HALF, (v / max) * HALF));

  const day = selected ? days.find((d) => d.date === selected) : undefined;
  const dayIndex = day ? days.indexOf(day) : -1;

  return (
    <section className="px-4 section-gap anim-fade-up">
      <div className="group-header">
        <h2 className="t-caption">Against target</h2>
      </div>

      <div className="flex group-list py-4">
        {/* The y axis, in a fixed gutter outside the scroller so it stays
            readable however far back you scroll. Both maxima come from the data
            rather than from a constant - see niceCeil. */}
        <div className="relative w-12 shrink-0 pr-2" style={{ height }} aria-hidden="true">
          <AxisLabel top={-4} value={calMax} unit="cals" />
          <AxisLabel top={HALF / 2 - 5} value={calMax / 2} />
          <AxisLabel top={HALF + HALF / 2 - 5} value={stepMax / 2} />
          <AxisLabel top={height - 18} value={stepMax} unit="steps" below />
        </div>

        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pr-3">
          <div ref={plot} className="relative" style={{ width, height }}>
            {/* Gridlines at half of each axis, and the day itself between them. */}
            <Grid top={HALF / 2} />
            <Grid top={HALF} centre />
            <Grid top={HALF + HALF / 2} />

            {days.map((d, i) => {
              const cal = up(d.calories, calMax);
              const step = up(d.steps, stepMax);
              const calLine = d.calTarget === undefined ? undefined : (d.calTarget / calMax) * HALF;
              const stepLine =
                d.stepTarget === undefined ? undefined : (d.stepTarget / stepMax) * HALF;
              const isSelected = selected === d.date;

              return (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${format(parseDayKey(d.date), "d MMM yyyy")}${
                    d.calories === undefined ? "" : `, ${d.calories} calories`
                  }${d.steps === undefined ? "" : `, ${d.steps} steps`}`}
                  onClick={() => setSelected(isSelected ? null : d.date)}
                  className="absolute top-0"
                  style={{ left: i * COL, width: COL, height }}
                >
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-1 right-1 rounded-sm bg-wash"
                    />
                  )}

                  {cal !== undefined && (
                    <span
                      className="absolute bg-ink-3"
                      style={{
                        left: (COL - BAR) / 2,
                        width: BAR,
                        bottom: HALF + 1,
                        height: cal,
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  )}
                  {step !== undefined && (
                    <span
                      className="absolute bg-ink"
                      style={{
                        left: (COL - BAR) / 2,
                        width: BAR,
                        top: HALF + 1,
                        height: step,
                        borderRadius: "0 0 2px 2px",
                      }}
                    />
                  )}

                  {/* One tick per day at that day's target. Consecutive equal
                      days merge into a line; a phase change shows as a step. */}
                  {calLine !== undefined && (
                    <span
                      className="absolute inset-x-0 h-px bg-ink-2"
                      style={{ top: HALF - calLine }}
                    />
                  )}
                  {stepLine !== undefined && (
                    <span
                      className="absolute inset-x-0 h-px bg-ink-2"
                      style={{ top: HALF + stepLine }}
                    />
                  )}
                </button>
              );
            })}

            {day && dayIndex >= 0 && (
              <DayCard
                day={day}
                // Beside the bar, and flipped to its other side near the end of
                // the chart so the card is never half off the scroller.
                left={
                  dayIndex * COL + 10 + 148 > width
                    ? Math.max(0, dayIndex * COL - 148 - 4)
                    : dayIndex * COL + COL + 4
                }
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Grid({ top, centre }: { top: number; centre?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-x-0 h-px ${centre ? "bg-rule-strong" : "bg-wash"}`}
      style={{ top }}
    />
  );
}

/**
 * One tick label. The unit sits UNDER its number rather than beside it: at
 * "20,000 steps" on one line the gutter has to be 70px wide, which on a 390px
 * phone is a quarter of the chart spent on a word.
 */
function AxisLabel({
  top,
  value,
  unit,
  below,
}: {
  top: number;
  value: number;
  unit?: string;
  /** Put the unit above the number instead, for the label on the bottom edge. */
  below?: boolean;
}) {
  const number = (
    <span style={{ fontSize: 10, lineHeight: 1.15 }}>{Math.round(value).toLocaleString()}</span>
  );
  const word = unit ? <span style={{ fontSize: 9, lineHeight: 1.15 }}>{unit}</span> : null;
  return (
    <span
      className="absolute right-2 flex flex-col items-end whitespace-nowrap text-right t-label text-ink-3"
      style={{ top }}
    >
      {below ? word : number}
      {below ? number : word}
    </span>
  );
}

interface DayRow {
  date: string;
  untracked: boolean;
  calories?: number;
  steps?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * One day, beside its own bar.
 *
 * A chart of two numbers per day cannot answer "what were the macros on the
 * 8th", and that is the question a spike in the calorie half makes you ask. So
 * the bar is a button and this is what it opens - in place, against the mark
 * you tapped, rather than on another screen.
 */
function DayCard({ day, left }: { day: DayRow; left: number }) {
  const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());
  const macros = [day.protein, day.carbs, day.fat];

  return (
    <div className="absolute top-1 z-10 w-[148px] rounded-lg bg-wash px-3 py-2" style={{ left }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label font-semibold text-ink">
          {format(parseDayKey(day.date), "EEE d MMM")}
        </span>
        {day.untracked && <span className="shrink-0 t-label text-ink-3">off</span>}
      </div>
      <dl className="mt-1.5 space-y-0.5">
        <Line label="Cals" value={n(day.calories)} />
        <Line label="Steps" value={n(day.steps)} />
        <Line
          label="P/C/F"
          value={macros.every((m) => m === undefined) ? "—" : macros.map((m) => n(m)).join(" / ")}
        />
      </dl>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="t-label text-ink-2" style={{ fontSize: 11 }}>
        {label}
      </dt>
      <dd className="t-label font-medium text-ink" style={{ fontSize: 12 }}>
        {value}
      </dd>
    </div>
  );
}
