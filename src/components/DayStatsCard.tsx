import { useMemo, type JSX, type ReactNode } from "react";
import { Flap } from "./Flap";
import { dayKey } from "../lib/daily-log";
import { useStore } from "../lib/store";
import { directionFor, targetStatusFor, type TargetStatus } from "../lib/targets";
import { useDayMacros } from "../lib/use-day-macros";

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
      className={`h-3 w-3 shrink-0 border border-ink-3 ${HATCH_CLASS[hatch]}`}
    />
  );
}

function StatusMark({ status }: { status: TargetStatus }) {
  if (status === "met") {
    // Same filled square as a ticked habit. One vocabulary for "done".
    return (
      <span aria-hidden="true" className="ml-2 inline-block h-2.5 w-2.5 bg-ink align-middle" />
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
    <div className={`group-row ${sep ? "group-row-sep" : ""}`}>
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
        {target === null && unit && <span className="ml-1 t-label text-ink-2">{unit}</span>}
        {status && <StatusMark status={status} />}
      </div>
    </div>
  );
}

/**
 * The calorie measure.
 *
 * Three versions of this have now existed. It began as three 10px rounded bars
 * beside the hero encoding protein, fat and carbs in three hues nobody could
 * name: a glyph pretending to be a chart, too small to read a quantity from and
 * repeating what the rows below state exactly. It then became a solid bar in a
 * track, which was legible but was a fill meter, and this system says rank comes
 * from rule weight and never from fill.
 *
 * It is a ruled measure now. A track outlined in ink, a hatched field for what
 * has been eaten, and quarter ticks under the rule so the quantity can be read
 * against a scale rather than estimated from a length. That is how a printed
 * gauge works, and the hatch is the same device the charts use to fill an area.
 *
 * The track IS the target, so reaching its end is reaching the goal. An overrun
 * continues past the end in the second ink, saying the same thing as the struck
 * rule under the figure above it.
 */
function CalorieGauge({
  logged,
  target,
  exceeded,
}: {
  logged: number;
  target: number;
  exceeded: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (logged / target) * 100));
  // Capped so a mistyped entry cannot push the overrun off the page.
  const overPct = exceeded ? Math.min(60, ((logged - target) / target) * 100) : 0;

  return (
    <div aria-hidden="true" className="mt-3">
      <div className="flex items-stretch">
        <div className="relative h-3 flex-1 border border-ink">
          <div className="hatch-dense h-full" style={{ width: `${pct}%` }} />
        </div>
        {overPct > 0 && (
          <div
            className="hatch-over h-3 shrink-0 border border-l-0 border-signal"
            style={{ width: `${overPct}%` }}
          />
        )}
      </div>
      {/* Quarter ticks, hung below the rule so the hatch never hides them. */}
      <div className="relative h-1">
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute top-0 h-1 w-px bg-ink-3" style={{ left: `${t}%` }} />
        ))}
      </div>
    </div>
  );
}

export function DayStatsCard({ date }: { date: string }): JSX.Element {
  const targetsEnabled = useStore((s) => s.targetsEnabled);
  const targetProfileForDate = useStore((s) => s.targetProfileForDate);
  const unit = useStore((s) => s.unit);
  const dailyLogs = useStore((s) => s.dailyLogs);

  const profile = targetsEnabled ? targetProfileForDate(date) : undefined;
  const dayMacros = useDayMacros(date);
  const dayLog = useMemo(() => dailyLogs.find((l) => l.date === date), [dailyLogs, date]);

  const isFuture = date > dayKey(new Date());

  const calories = dayMacros.calories ?? dayLog?.calories;
  const protein = dayMacros.protein ?? dayLog?.protein;
  const carbs = dayMacros.carbs ?? dayLog?.carbs;
  const fat = dayMacros.fat ?? dayLog?.fat;
  const steps = dayLog?.steps;
  const bodyweight = dayLog?.bodyweight;

  const positive = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);
  const targetCalories = positive(profile?.calories);
  const targetProtein = positive(profile?.protein);
  const targetFat = positive(profile?.fat);
  const targetCarbs = positive(profile?.carbs);
  const targetSteps = positive(profile?.steps);

  const calorieDirection = directionFor("calories", profile?.goalMode);
  const isGain = calorieDirection === "floor";

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

  let remainingText: string | null = null;
  if (!isFuture && targetCalories !== undefined) {
    const remainingSuffix = isGain ? "calories to go" : "calories left";
    const diff = targetCalories - (calories ?? 0);
    if (diff >= 0) {
      remainingText = `${Math.round(diff).toLocaleString()} ${remainingSuffix}`;
    } else {
      const over = Math.round((calories ?? 0) - targetCalories);
      remainingText = `${over.toLocaleString()} calories over`;
    }
  }

  const showBodyweight = !isFuture && bodyweight !== undefined;
  const round = (n: number) => Math.round(n).toLocaleString();

  /**
   * A day with nothing logged and no targets set has no table to draw.
   *
   * It used to render one anyway: a lone "Not recorded" over an empty ruled
   * band. That was a table with its contents missing rather than an empty
   * state, and once the numbers moved above the canvas it was the second thing
   * on the screen, which made a fresh day and a full day pixel-identical for
   * their first third. An empty state that shares the populated state's shape
   * is not an empty state.
   *
   * The line below is deliberately not built from the app's usual empty-state
   * frame. No imperative, no purpose clause, no pointing at a control: the
   * header directly above it already says "Daily numbers" and carries the Edit
   * that fills them in.
   */
  const nothingToShow =
    !isFuture &&
    calories === undefined &&
    bodyweight === undefined &&
    targetCalories === undefined &&
    targetProtein === undefined &&
    targetFat === undefined &&
    targetCarbs === undefined &&
    targetSteps === undefined;

  if (nothingToShow) {
    return (
      // -mx-5 to match group-list: every table on this page opens with a rule
      // that reaches the trim, and an inset one here would read as a different
      // kind of object rather than as the same table with nothing in it.
      <div className="-mx-5 rule-heavy-t border-b border-rule-strong px-5 py-4">
        <p className="t-body text-ink-2">This day is still blank.</p>
      </div>
    );
  }

  return (
    <div className="group-list">
      {/* The hero: the one figure this screen exists to show, at timetable
          scale, with its gauge directly beneath it. */}
      <div className="px-5 pt-4 pb-4">
        {isFuture ? (
          targetCalories !== undefined ? (
            <div className="flex items-baseline gap-1.5">
              <span className="t-hero text-ink">{round(targetCalories)}</span>
              <span className="t-label text-ink-2">kcal planned</span>
            </div>
          ) : (
            <div className="t-label text-ink-2">No calorie target for this day</div>
          )
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              {calories !== undefined ? (
                <Flap value={round(calories)}>
                  <span
                    className={`t-hero text-ink ${calorieStatus === "exceeded" ? "mark-over" : ""}`}
                  >
                    {round(calories)}
                  </span>
                </Flap>
              ) : (
                <span className="t-stat text-ink-3">Not recorded</span>
              )}
              {targetCalories !== undefined ? (
                <span className="t-label text-ink-2">/ {round(targetCalories)} kcal</span>
              ) : (
                calories !== undefined && <span className="t-label text-ink-2">kcal</span>
              )}
            </div>
            {remainingText && <div className="mt-1 t-label text-ink-2">{remainingText}</div>}
            {calories !== undefined && targetCalories !== undefined && (
              <CalorieGauge
                logged={calories}
                target={targetCalories}
                exceeded={calorieStatus === "exceeded"}
              />
            )}
          </>
        )}
      </div>

      {targetProtein !== undefined && (
        <MetricRow
          sep
          label="Protein"
          hatch="protein"
          // On a future day the target IS the figure: there is nothing logged
          // to compare it against, and printing "Not recorded" against every row
          // of a day that has not happened yet reports a gap rather than a plan.
          value={isFuture ? round(targetProtein) : protein !== undefined ? round(protein) : null}
          target={isFuture ? null : round(targetProtein)}
          unit="g"
          status={statusOf("protein", protein, targetProtein)}
        />
      )}

      {targetFat !== undefined && (
        <MetricRow
          sep
          label="Fat"
          hatch="fat"
          // On a future day the target IS the figure: there is nothing logged
          // to compare it against, and printing "Not recorded" against every row
          // of a day that has not happened yet reports a gap rather than a plan.
          value={isFuture ? round(targetFat) : fat !== undefined ? round(fat) : null}
          target={isFuture ? null : round(targetFat)}
          unit="g"
          status={statusOf("fat", fat, targetFat)}
        />
      )}

      {targetCarbs !== undefined && (
        <MetricRow
          sep
          label="Carbs"
          hatch="carbs"
          // On a future day the target IS the figure: there is nothing logged
          // to compare it against, and printing "Not recorded" against every row
          // of a day that has not happened yet reports a gap rather than a plan.
          value={isFuture ? round(targetCarbs) : carbs !== undefined ? round(carbs) : null}
          target={isFuture ? null : round(targetCarbs)}
          unit="g"
          status={statusOf("carbs", carbs, targetCarbs)}
        />
      )}

      {targetSteps !== undefined && (
        <MetricRow
          sep
          label="Steps"
          hatch="solid"
          value={
            isFuture
              ? targetSteps.toLocaleString()
              : steps !== undefined
                ? steps.toLocaleString()
                : null
          }
          target={isFuture ? null : targetSteps.toLocaleString()}
          status={statusOf("steps", steps, targetSteps)}
        />
      )}

      {showBodyweight && (
        <MetricRow
          sep
          label="Bodyweight"
          hatch="open"
          value={String(bodyweight)}
          target={null}
          unit={unit}
          status={null}
        />
      )}
    </div>
  );
}
