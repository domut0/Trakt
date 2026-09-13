import { useMemo, type JSX, type ReactNode } from "react";
import { Flap } from "./Flap";
import { dayKey } from "../lib/daily-log";
import { useStore } from "../lib/store";
import { directionFor, targetStatusFor, type TargetStatus } from "../lib/targets";

/**
 * The day's numbers, set as a table.
 *
 * Two things changed here beyond the repaint, and both were latent bugs rather
 * than taste:
 *
 * 1. The card never called `targetStatusFor`, so a day that hit every target
 *    looked exactly like a day that missed every target. The library has
 *    known the difference between a floor, a ceiling and a band since targets
 *    shipped: a floor cannot be exceeded (12,480 steps against 10,000 is a
 *    surplus, not a violation) and a ceiling cannot be met (being under your
 *    calories at 9am is breakfast, not an achievement). The rows now read that
 *    status instead of printing a bare figure and leaving him to do the
 *    arithmetic.
 * 2. Five rows were five near-identical copies of the same twenty lines, which
 *    is why the missing status was missing five times. There is one row now.
 *
 * Status is carried by MARK, never by hue: a filled square for met, and the
 * second ink with a struck rule under the figure for exceeded. The old card
 * had no marks at all, and the system it inherited from would have used green
 * and amber, which its own notes recorded as indistinguishable to a protanope.
 */

type MetricHatch = "protein" | "fat" | "carbs" | "solid" | "open";

const HATCH_CLASS: Record<MetricHatch, string> = {
  protein: "hatch-protein",
  fat: "hatch-fat",
  carbs: "hatch-carbs",
  solid: "hatch-solid",
  open: "",
};

/**
 * The key beside a metric's name.
 *
 * Seven hues became one ink and a set of hatches: angle carries identity,
 * density carries emphasis. It reads at arm's length in gym light, it survives
 * any colour vision, and unlike a coloured dot it cannot be mistaken for
 * decoration, because a hatch has no other job.
 */
function MetricKey({ hatch }: { hatch: MetricHatch }) {
  return (
    <span
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 rounded-sm border border-ink-3 ${HATCH_CLASS[hatch]}`}
    />
  );
}

function StatusMark({ status }: { status: TargetStatus }) {
  if (status === "met") {
    // Same filled square as a ticked habit. One vocabulary for "done".
    return (
      <span
        aria-hidden="true"
        className="ml-2 inline-block h-2.5 w-2.5 bg-ink align-middle rounded-md"
      />
    );
  }
  return null;
}

function MetricRow({
  label,
  hatch,
  value,
  target,
  unit,
  status,
  sep,
  strongSep,
}: {
  label: string;
  hatch: MetricHatch;
  /** Already-rounded display value, or null when nothing was logged. */
  value: string | null;
  /** Already-rounded display target, or null when no target is set. */
  target: string | null;
  unit?: string;
  status: TargetStatus | null;
  sep: boolean;
  /** A real division rather than a hairline. One row uses it: the first of the
   * evening block, because the row above it is the morning's. */
  strongSep?: boolean;
}) {
  const exceeded = status === "exceeded";

  let figure: ReactNode;
  if (value === null) {
    figure = <span className="t-label text-ink-3">Not recorded</span>;
  } else {
    figure = (
      <Flap value={value}>
        <span className={`t-stat text-ink ${exceeded ? "mark-over" : ""}`}>{value}</span>
      </Flap>
    );
  }

  return (
    <div className={`group-row ${strongSep ? "rule-t" : sep ? "group-row-sep" : ""}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <MetricKey hatch={hatch} />
        <span className="t-body text-ink">{label}</span>
      </div>
      <div className="flex shrink-0 items-baseline">
        {figure}
        {target !== null && (
          <span className="ml-1 t-label text-ink-2">
            / {target}
            {unit ? ` ${unit}` : ""}
          </span>
        )}
        {/* A unit needs a quantity to qualify. "Not recorded lbs" reads as a
            broken string rather than as an empty row. */}
        {target === null && unit && value !== null && (
          <span className="ml-1 t-label text-ink-2">{unit}</span>
        )}
        {status && <StatusMark status={status} />}
      </div>
    </div>
  );
}

export function DayStatsCard({ date }: { date: string }): JSX.Element {
  const targetsForDay = useStore((s) => s.targetsForDay);
  const nutritionPhases = useStore((s) => s.nutritionPhases);
  const unit = useStore((s) => s.unit);
  const dailyLogs = useStore((s) => s.dailyLogs);

  // Recomputed when the timeline changes, not just when the date does: editing a
  // phase has to move every day it governs, and the resolver is a store getter
  // that React cannot see through on its own.
  const profile = useMemo(
    () => targetsForDay(date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, nutritionPhases, targetsForDay],
  );
  const dayLog = useMemo(() => dailyLogs.find((l) => l.date === date), [dailyLogs, date]);

  const isFuture = date > dayKey(new Date());

  const calories = dayLog?.calories;
  const protein = dayLog?.protein;
  const carbs = dayLog?.carbs;
  const fat = dayLog?.fat;
  const steps = dayLog?.steps;
  const bodyweight = dayLog?.bodyweight;

  const positive = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);
  const targetCalories = positive(profile?.calories);
  const targetProtein = positive(profile?.protein);
  const targetFat = positive(profile?.fat);
  const targetCarbs = positive(profile?.carbs);
  const targetSteps = positive(profile?.steps);

  /** Status for one field, or null when the day is future or either half is
   * missing. Progress needs both a logged value and a target to mean anything. */
  const statusOf = (
    field: "calories" | "protein" | "fat" | "carbs" | "steps",
    logged: number | undefined,
    target: number | undefined,
  ): TargetStatus | null => {
    if (isFuture || logged === undefined || target === undefined) return null;
    return targetStatusFor(directionFor(field, profile?.goalMode), logged, target);
  };

  const calorieStatus = statusOf("calories", calories, targetCalories);

  const round = (n: number) => Math.round(n).toLocaleString();

  /** Every row draws, logged or not.
   *
   * This card used to hide a row whenever its TARGET was unset - not its value,
   * its target - so on a day with no targets configured the screen showed a
   * calorie figure and nothing else, and no amount of logging made protein
   * appear. A whole-card empty state sat in front of that, so a blank day said
   * "This day is still blank" and offered no hint of what could go on it.
   *
   * Both are gone. The card is a fixed list of the six numbers this app is
   * for, and an unlogged one reads "Not recorded" in its own row. The shape of
   * the day does not change as you fill it in; only the figures do. That is
   * what makes it usable half-asleep: the row you want is always in the same
   * place.
   */
  const figureFor = (logged: number | undefined, target: number | undefined): string | null => {
    // On a future day the target IS the figure. Printing "Not recorded" against
    // every row of a day that has not happened yet reports a gap rather than a
    // plan.
    if (isFuture) return target !== undefined ? round(target) : null;
    return logged !== undefined ? round(logged) : null;
  };

  return (
    <div className="group-list">
      {/* Bodyweight first, and alone above a real division.

          The app is opened twice a day and they are different visits: this is
          the morning one, standing on a scale, and everything below is the
          evening one, filling in the day from memory. Ordering by when a number
          is entered rather than by what it measures is what gives each visit a
          single obvious target. */}
      <MetricRow
        sep={false}
        label="Bodyweight"
        hatch="open"
        value={isFuture ? null : bodyweight !== undefined ? String(bodyweight) : null}
        target={null}
        unit={unit}
        status={null}
      />

      <MetricRow
        sep={false}
        strongSep
        label="Calories"
        hatch="solid"
        value={figureFor(calories, targetCalories)}
        target={isFuture || targetCalories === undefined ? null : round(targetCalories)}
        unit="kcal"
        status={calorieStatus}
      />
      <MetricRow
        sep
        label="Protein"
        hatch="protein"
        value={figureFor(protein, targetProtein)}
        target={isFuture || targetProtein === undefined ? null : round(targetProtein)}
        unit="g"
        status={statusOf("protein", protein, targetProtein)}
      />
      <MetricRow
        sep
        label="Carbs"
        hatch="carbs"
        value={figureFor(carbs, targetCarbs)}
        target={isFuture || targetCarbs === undefined ? null : round(targetCarbs)}
        unit="g"
        status={statusOf("carbs", carbs, targetCarbs)}
      />
      <MetricRow
        sep
        label="Fat"
        hatch="fat"
        value={figureFor(fat, targetFat)}
        target={isFuture || targetFat === undefined ? null : round(targetFat)}
        unit="g"
        status={statusOf("fat", fat, targetFat)}
      />
      <MetricRow
        sep
        label="Steps"
        hatch="solid"
        value={figureFor(steps, targetSteps)}
        target={isFuture || targetSteps === undefined ? null : round(targetSteps)}
        status={statusOf("steps", steps, targetSteps)}
      />
    </div>
  );
}
