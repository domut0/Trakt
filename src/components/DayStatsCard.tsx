import { useState, useMemo, type JSX, type ReactNode } from "react";
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

type NumKey = "calories" | "protein" | "carbs" | "fat" | "steps" | "bodyweight";

interface EditableField {
  /** `stat-calories` and friends, so a checklist row can send you to the field. */
  id: string;
  /** Raw text to display, which is the stored number unless this field is the
   *  one being typed into. */
  raw: string;
  /** Shown in grey when nothing is entered. On a future day this is the target,
   *  so a day that has not happened yet still shows its plan. */
  placeholder: string;
  decimal?: boolean;
  onChange: (raw: string) => void;
  onBlur: () => void;
}

/**
 * One number, edited where it is read.
 *
 * There is no sheet behind this any more. The sheet held the same six fields
 * with the same labels against the same targets, so opening it swapped a card
 * for its own copy and asked you to press Save at the end of it.
 *
 * The raw string is held by the PARENT, and only for the field currently
 * focused - see `editing` in DayStatsCard. Storing it per-field would fight a
 * write from anywhere else (the Copy-the-day-before button, a sheet sync);
 * storing none of it would collapse "12." to "12" under your cursor as the
 * number went out to the store and came back.
 */
function FigureField({
  id,
  raw,
  placeholder,
  decimal,
  onChange,
  onBlur,
  exceeded,
  label,
}: EditableField & { exceeded: boolean; label: string }) {
  return (
    <input
      id={id}
      type="number"
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={label}
      value={raw}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      /* Filled, not bare. These six are the app's most-used inputs and they
         read as printed values until you happen to tap one, which is the
         complaint that put the `field` token in the palette. The box hugs its
         own content so a row of them still scans as figures rather than as a
         form, and it keeps a floor so an unlogged day is a target you can hit
         rather than a dash. */
      className={`min-w-0 rounded-md bg-field px-2 py-0.5 text-right t-stat text-ink outline-none placeholder:font-normal placeholder:text-ink-3 ${
        exceeded ? "mark-over" : ""
      }`}
      /* Content width plus the horizontal padding, because the box sizes
         border-box and the padding would otherwise eat the digits. */
      style={{ width: `calc(${Math.max(raw.length, placeholder.length, 4)}ch + 1rem)` }}
    />
  );
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
  field,
  tutorial,
}: {
  /** data-tutorial marker, so the tutorial can point at one row of six. */
  tutorial?: string;
  /** When given, the figure is an input writing straight to the day's log
   *  instead of a printed number. */
  field?: EditableField;
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
  if (field) {
    figure = <FigureField {...field} exceeded={exceeded} label={label} />;
  } else if (value === null) {
    figure = <span className="t-label text-ink-3">Not recorded</span>;
  } else {
    figure = (
      <Flap value={value}>
        <span className={`t-stat text-ink ${exceeded ? "mark-over" : ""}`}>{value}</span>
      </Flap>
    );
  }

  return (
    <div
      data-tutorial={tutorial}
      className={`group-row ${strongSep ? "rule-t" : sep ? "group-row-sep" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MetricKey hatch={hatch} />
        {/* A real label, so tapping the word focuses the number beside it.
            Six rows of a card that look tappable and are not is a card that
            reads as broken, and on the tutorial's bodyweight step the row IS
            the only thing on screen to tap. */}
        {field ? (
          <label htmlFor={field.id} className="t-body text-ink">
            {label}
          </label>
        ) : (
          <span className="t-body text-ink">{label}</span>
        )}
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

export function DayStatsCard({
  date,
  editable = false,
}: {
  date: string;
  /** Turns every figure into an input writing straight to the log. */
  editable?: boolean;
}): JSX.Element {
  const phaseForDay = useStore((s) => s.phaseForDay);
  const upsertDailyLog = useStore((s) => s.upsertDailyLog);
  const nutritionPhases = useStore((s) => s.nutritionPhases);
  const unit = useStore((s) => s.unit);
  const dailyLogs = useStore((s) => s.dailyLogs);

  // Recomputed when the timeline changes, not just when the date does: editing a
  // phase has to move every day it governs, and the resolver is a store getter
  // that React cannot see through on its own.
  const profile = useMemo(
    () => phaseForDay(date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, nutritionPhases, phaseForDay],
  );
  const dayLog = useMemo(() => dailyLogs.find((l) => l.date === date), [dailyLogs, date]);

  const isFuture = date > dayKey(new Date());

  const round = (n: number) => Math.round(n).toLocaleString();

  /** The field being typed into, and the exact text in it. Only one field can
   *  be focused, so one slot is all this needs - and every other field stays
   *  driven by the store, so an outside write lands immediately. */
  const [editing, setEditing] = useState<{ field: NumKey; raw: string } | null>(null);

  const fieldFor = (
    key: NumKey,
    target: number | undefined,
    decimal = false,
  ): EditableField | undefined => {
    if (!editable) return undefined;
    const stored = dayLog?.[key];
    return {
      id: `stat-${key}`,
      raw: editing?.field === key ? editing.raw : stored === undefined ? "" : String(stored),
      // On a day that has not happened yet the target IS the hint, so the plan
      // is what an empty row shows.
      placeholder: isFuture && target !== undefined ? round(target) : "—",
      decimal,
      onChange: (raw) => {
        setEditing({ field: key, raw });
        // "" means NOT LOGGED, so it maps to undefined, never to 0. A typed 0
        // is kept: zero steps is a real answer.
        const trimmed = raw.trim();
        const n = Number(trimmed);
        upsertDailyLog(date, { [key]: trimmed === "" || !Number.isFinite(n) ? undefined : n });
      },
      onBlur: () => setEditing(null),
    };
  };

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
    const direction = directionFor(field);
    // Macros carry no direction and so get no mark. They are a number beside a
    // number, not a thing you passed or failed.
    if (direction === undefined) return null;
    return targetStatusFor(direction, logged, target);
  };

  const calorieStatus = statusOf("calories", calories, targetCalories);

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
        tutorial="stat-bodyweight"
        label="Bodyweight"
        field={fieldFor("bodyweight", undefined, true)}
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
        field={fieldFor("calories", targetCalories)}
        hatch="solid"
        value={figureFor(calories, targetCalories)}
        target={isFuture || targetCalories === undefined ? null : round(targetCalories)}
        unit="kcal"
        status={calorieStatus}
      />
      <MetricRow
        sep
        label="Protein"
        field={fieldFor("protein", targetProtein)}
        hatch="protein"
        value={figureFor(protein, targetProtein)}
        target={isFuture || targetProtein === undefined ? null : round(targetProtein)}
        unit="g"
        status={statusOf("protein", protein, targetProtein)}
      />
      <MetricRow
        sep
        label="Carbs"
        field={fieldFor("carbs", targetCarbs)}
        hatch="carbs"
        value={figureFor(carbs, targetCarbs)}
        target={isFuture || targetCarbs === undefined ? null : round(targetCarbs)}
        unit="g"
        status={statusOf("carbs", carbs, targetCarbs)}
      />
      <MetricRow
        sep
        label="Fat"
        field={fieldFor("fat", targetFat)}
        hatch="fat"
        value={figureFor(fat, targetFat)}
        target={isFuture || targetFat === undefined ? null : round(targetFat)}
        unit="g"
        status={statusOf("fat", fat, targetFat)}
      />
      <MetricRow
        sep
        label="Steps"
        field={fieldFor("steps", targetSteps)}
        hatch="solid"
        value={figureFor(steps, targetSteps)}
        target={isFuture || targetSteps === undefined ? null : round(targetSteps)}
        status={statusOf("steps", steps, targetSteps)}
      />

      {/* There was an "Untracked" switch here, the one row on this card that
          was not a number. It let you declare a day deliberately unlogged -
          which the day was already declaring by having nothing on it. */}
    </div>
  );
}
