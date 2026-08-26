import { useMemo, type JSX } from "react";
import { dayKey } from "../lib/daily-log";
import { useStore } from "../lib/store";
import { directionFor } from "../lib/targets";
import { useDayMacros } from "../lib/use-day-macros";

/**
 * Day stats card showing calories and macros against targets.
 *
 * Modelled on Food You:
 * - Hero calories over target with remaining line ("left" on cut/maintain, "to go" on gain).
 * - Three vertical bar glyphs for protein, fat, carbs with track going down to --background.
 * - Macro rows for each configured target.
 * - Steps row if steps target is configured.
 * - Bodyweight row (value only, no target).
 *
 * In future day mode (date after today), shows targets alone with no logged values,
 * no hero number, no remaining line, and no bodyweight row.
 */
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

  const targetCalories =
    profile?.calories !== undefined && profile.calories > 0 ? profile.calories : undefined;
  const targetProtein =
    profile?.protein !== undefined && profile.protein > 0 ? profile.protein : undefined;
  const targetFat = profile?.fat !== undefined && profile.fat > 0 ? profile.fat : undefined;
  const targetCarbs = profile?.carbs !== undefined && profile.carbs > 0 ? profile.carbs : undefined;
  const targetSteps = profile?.steps !== undefined && profile.steps > 0 ? profile.steps : undefined;

  const calorieDirection = directionFor("calories", profile?.goalMode);
  const isGain = calorieDirection === "floor";

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

  // Three vertical bar percentages (protein, fat, carbs)
  const proteinPct =
    targetProtein !== undefined && !isFuture && protein !== undefined
      ? Math.min(100, Math.max(0, (protein / targetProtein) * 100))
      : 0;

  const fatPct =
    targetFat !== undefined && !isFuture && fat !== undefined
      ? Math.min(100, Math.max(0, (fat / targetFat) * 100))
      : 0;

  const carbsPct =
    targetCarbs !== undefined && !isFuture && carbs !== undefined
      ? Math.min(100, Math.max(0, (carbs / targetCarbs) * 100))
      : 0;

  const showBodyweight = !isFuture && bodyweight !== undefined;

  return (
    <div className="group-list">
      {/* Top section: calories, remaining line, and 3 vertical bar glyphs */}
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 flex-1">
          {isFuture ? (
            <div>
              {targetCalories !== undefined ? (
                <div className="t-stat text-foreground">
                  {Math.round(targetCalories).toLocaleString()}{" "}
                  <span className="t-label font-normal text-muted-foreground">kcal</span>
                </div>
              ) : (
                <div className="t-label text-muted-foreground">No calorie target</div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                {calories !== undefined ? (
                  <span className="t-hero font-bold text-foreground">
                    {Math.round(calories).toLocaleString()}
                  </span>
                ) : (
                  <span className="t-body font-medium text-muted-foreground">Not recorded</span>
                )}
                {targetCalories !== undefined && (
                  <span className="t-label text-muted-foreground">
                    / {Math.round(targetCalories).toLocaleString()} kcal
                  </span>
                )}
                {targetCalories === undefined && calories !== undefined && (
                  <span className="t-label text-muted-foreground">kcal</span>
                )}
              </div>
              {remainingText && (
                <div className="t-label text-muted-foreground mt-1">{remainingText}</div>
              )}
            </>
          )}
        </div>

        {/* Three vertical bar glyphs: protein, fat, carbs */}
        <div className="flex items-end gap-1 shrink-0 pt-1" aria-hidden="true">
          <div className="h-7 w-2 rounded-full bg-background overflow-hidden flex flex-col justify-end">
            <div
              className="w-full rounded-full transition-all"
              style={{
                height: `${proteinPct}%`,
                backgroundColor: "var(--color-protein)",
              }}
            />
          </div>
          <div className="h-7 w-2 rounded-full bg-background overflow-hidden flex flex-col justify-end">
            <div
              className="w-full rounded-full transition-all"
              style={{
                height: `${fatPct}%`,
                backgroundColor: "var(--color-fat)",
              }}
            />
          </div>
          <div className="h-7 w-2 rounded-full bg-background overflow-hidden flex flex-col justify-end">
            <div
              className="w-full rounded-full transition-all"
              style={{
                height: `${carbsPct}%`,
                backgroundColor: "var(--color-carbs)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Three macro rows */}
      {targetProtein !== undefined && (
        <div className="group-row group-row-sep">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--color-protein)" }}
            />
            <span className="t-body font-medium text-foreground">Protein</span>
          </div>
          <div className="t-stat text-foreground">
            {isFuture ? (
              <>
                {Math.round(targetProtein)}{" "}
                <span className="t-label font-normal text-muted-foreground">g</span>
              </>
            ) : protein !== undefined ? (
              <>
                {Math.round(protein)}{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetProtein)} g
                </span>
              </>
            ) : (
              <>
                <span className="t-label font-normal text-muted-foreground">Not recorded</span>{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetProtein)} g
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {targetFat !== undefined && (
        <div className="group-row group-row-sep">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--color-fat)" }}
            />
            <span className="t-body font-medium text-foreground">Fat</span>
          </div>
          <div className="t-stat text-foreground">
            {isFuture ? (
              <>
                {Math.round(targetFat)}{" "}
                <span className="t-label font-normal text-muted-foreground">g</span>
              </>
            ) : fat !== undefined ? (
              <>
                {Math.round(fat)}{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetFat)} g
                </span>
              </>
            ) : (
              <>
                <span className="t-label font-normal text-muted-foreground">Not recorded</span>{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetFat)} g
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {targetCarbs !== undefined && (
        <div className="group-row group-row-sep">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--color-carbs)" }}
            />
            <span className="t-body font-medium text-foreground">Carbs</span>
          </div>
          <div className="t-stat text-foreground">
            {isFuture ? (
              <>
                {Math.round(targetCarbs)}{" "}
                <span className="t-label font-normal text-muted-foreground">g</span>
              </>
            ) : carbs !== undefined ? (
              <>
                {Math.round(carbs)}{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetCarbs)} g
                </span>
              </>
            ) : (
              <>
                <span className="t-label font-normal text-muted-foreground">Not recorded</span>{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {Math.round(targetCarbs)} g
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Steps row */}
      {targetSteps !== undefined && (
        <div className="group-row group-row-sep">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--color-steps)" }}
            />
            <span className="t-body font-medium text-foreground">Steps</span>
          </div>
          <div className="t-stat text-foreground">
            {isFuture ? (
              <>{targetSteps.toLocaleString()}</>
            ) : steps !== undefined ? (
              <>
                {steps.toLocaleString()}{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {targetSteps.toLocaleString()}
                </span>
              </>
            ) : (
              <>
                <span className="t-label font-normal text-muted-foreground">Not recorded</span>{" "}
                <span className="t-label font-normal text-muted-foreground">
                  / {targetSteps.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bodyweight row (value only, no target, hidden in future mode) */}
      {showBodyweight && (
        <div className="group-row group-row-sep">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "var(--color-bodyweight)" }}
            />
            <span className="t-body font-medium text-foreground">Bodyweight</span>
          </div>
          <div className="t-stat text-foreground">
            {bodyweight} <span className="t-label font-normal text-muted-foreground">{unit}</span>
          </div>
        </div>
      )}
    </div>
  );
}
