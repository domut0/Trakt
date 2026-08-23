import type { DailyLog } from "./store";

/**
 * Food logging: types and the portion maths.
 *
 * NOTE: `import type` above is deliberate, matching `daily-log.ts`. store.ts
 * imports from this module, so a value import here would close a runtime cycle.
 *
 * The one idea this module exists to protect: **a logged entry carries its own
 * copy of the food's basis**, so correcting or deleting a food never rewrites
 * what you ate last month. See the plan's decision 3. `foodId` is a soft link
 * for "log this again", never a foreign key, and nothing resolves an entry's
 * macros by looking the food back up.
 */

/** What the user may type a portion in. The full set is offered on every food. */
export type MeasurementUnit = "g" | "ml" | "oz" | "floz" | "serving" | "package";

export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = [
  "g",
  "ml",
  "oz",
  "floz",
  "serving",
  "package",
] as const;

/** Grams per unit, for the units that denote mass. */
const GRAMS: Partial<Record<MeasurementUnit, number>> = { g: 1, oz: 28.3495 };
/** Millilitres per unit, for the units that denote volume. */
const MILLILITRES: Partial<Record<MeasurementUnit, number>> = { ml: 1, floz: 29.5735 };

export const UNIT_LABELS: Record<MeasurementUnit, string> = {
  g: "g",
  ml: "ml",
  oz: "oz",
  floz: "fl oz",
  serving: "serving",
  package: "package",
};

/** The four numbers this app tracks. Decision 2: nothing else, deliberately. */
export interface Macros {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * The amount a set of macros describes, and the weights needed to convert into
 * it.
 *
 * Open Food Facts and USDA give per-100g, so those arrive as `100` / `"g"`. A
 * MyFitnessPal food known only as "1 cake" arrives as `1` / `"serving"` with
 * `servingLabel: "cake"` and no `servingWeight` at all: 46% of real logged
 * portions have no gram equivalent, so a fixed per-100g basis cannot represent
 * the catalogue.
 */
export interface MacroBasis extends Macros {
  basisQuantity: number;
  basisUnit: "g" | "ml" | "serving";
  /** User-facing noun for one serving ("cake", "cup dry"). Absent means "serving". */
  servingLabel?: string;
  /** Grams in one serving. Nullable on purpose; decision 11 fills it in on demand. */
  servingWeight?: number;
  /** Grams in one package. */
  packageWeight?: number;
}

export type FoodSource = "user" | "mfp" | "off" | "usda";

/** A food in the catalogue. Editable, searchable, and never read to resolve history. */
export interface Food extends MacroBasis {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  sourceType: FoodSource;
  /** Provenance for an imported food. Attribution for Open Food Facts lives here. */
  sourceUrl?: string;
  /** Switches the default unit to millilitres. */
  isLiquid?: boolean;
  createdAt: number;
}

/**
 * One logged portion.
 *
 * Extends `MacroBasis` because the basis is **frozen onto the entry** at log
 * time. That is what lets an old entry's quantity still be edited, and what
 * stops an upstream correction from silently rewriting history.
 */
export interface FoodEntry extends MacroBasis {
  id: string;
  /** LOCAL calendar date as "yyyy-MM-dd", matching `dayKey`. */
  date: string;
  mealId: string;
  quantity: number;
  unit: MeasurementUnit;
  /** Frozen at log time, so a renamed or deleted food leaves the diary intact. */
  name: string;
  brand?: string;
  /** Soft link for "log this again". NOT a foreign key. */
  foodId?: string;
  /** Soft link to the recipe this came from, if any. */
  recipeId?: string;
  loggedAt: number;
}

/**
 * A meal slot. User-owned: renameable, reorderable, deletable.
 *
 * Times are minutes since local midnight rather than the hour/minute pairs
 * FoodYou stores, because every read of them is a range comparison and the
 * split form just means reassembling it first. Same information.
 *
 * A window where `from === to` is all-day.
 */
export interface Meal {
  id: string;
  name: string;
  fromMinutes: number;
  toMinutes: number;
  rank: number;
}

/** A composed food. Ingredients are foods; nesting is out of scope (plan §2). */
export interface Recipe {
  id: string;
  name: string;
  /** How many servings the whole recipe makes. Must be >= 1. */
  servings: number;
  note?: string;
  isLiquid?: boolean;
  createdAt: number;
}

export interface RecipeIngredient {
  id: string;
  recipeId: string;
  foodId: string;
  quantity: number;
  unit: MeasurementUnit;
}

// --- Portion maths --------------------------------------------------------

/**
 * Why a portion could not be turned into macros.
 *
 * `needsServingWeight` and `needsPackageWeight` are not failures so much as
 * questions: decision 11 turns them into a prompt that writes the answer back
 * onto the food, so the same portion resolves forever after.
 */
export type BasisError = "needsServingWeight" | "needsPackageWeight" | "incompatibleUnit";

export type FactorResult = { ok: true; factor: number } | { ok: false; reason: BasisError };

/**
 * How many multiples of `basis` a portion of `quantity` `unit` represents.
 *
 * Both sides are reduced to a common footing before dividing: grams where the
 * food is mass-based, millilitres where it is volume-based, and plain serving
 * counts where the food is only ever known per-serving.
 */
export function measurementFactor(
  basis: MacroBasis,
  quantity: number,
  unit: MeasurementUnit,
): FactorResult {
  if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, reason: "incompatibleUnit" };
  if (!Number.isFinite(basis.basisQuantity) || basis.basisQuantity <= 0) {
    return { ok: false, reason: "incompatibleUnit" };
  }

  // Reduce the portion to grams, millilitres, or a serving count.
  const grams = GRAMS[unit] != null ? quantity * GRAMS[unit]! : null;
  const millilitres = MILLILITRES[unit] != null ? quantity * MILLILITRES[unit]! : null;

  if (unit === "package") {
    if (basis.packageWeight == null) return { ok: false, reason: "needsPackageWeight" };
    return fromGrams(basis, quantity * basis.packageWeight);
  }

  if (unit === "serving") {
    if (basis.basisUnit === "serving") return { ok: true, factor: quantity / basis.basisQuantity };
    if (basis.servingWeight == null) return { ok: false, reason: "needsServingWeight" };
    return fromGrams(basis, quantity * basis.servingWeight);
  }

  if (grams != null) {
    if (basis.basisUnit === "g") return { ok: true, factor: grams / basis.basisQuantity };
    if (basis.basisUnit === "serving") {
      if (basis.servingWeight == null) return { ok: false, reason: "needsServingWeight" };
      return { ok: true, factor: grams / (basis.servingWeight * basis.basisQuantity) };
    }
    // Mass typed against a millilitre basis. Assuming 1 g/ml would silently
    // invent a density, so refuse instead.
    return { ok: false, reason: "incompatibleUnit" };
  }

  if (millilitres != null) {
    if (basis.basisUnit === "ml") return { ok: true, factor: millilitres / basis.basisQuantity };
    return { ok: false, reason: "incompatibleUnit" };
  }

  return { ok: false, reason: "incompatibleUnit" };
}

/** Shared tail for the paths that have already reduced a portion to grams. */
function fromGrams(basis: MacroBasis, grams: number): FactorResult {
  if (basis.basisUnit === "g") return { ok: true, factor: grams / basis.basisQuantity };
  if (basis.basisUnit === "serving") {
    if (basis.servingWeight == null) return { ok: false, reason: "needsServingWeight" };
    return { ok: true, factor: grams / (basis.servingWeight * basis.basisQuantity) };
  }
  return { ok: false, reason: "incompatibleUnit" };
}

const scale = (v: number | undefined, by: number): number | undefined =>
  v == null ? undefined : v * by;

/** Scales a basis by a factor. Absent stays absent: an unknown macro is not zero. */
export function scaleMacros(basis: Macros, factor: number): Macros {
  return {
    calories: scale(basis.calories, factor),
    protein: scale(basis.protein, factor),
    carbs: scale(basis.carbs, factor),
    fat: scale(basis.fat, factor),
  };
}

/** The macros of one logged entry, from its own frozen basis. Never reads the foods table. */
export function entryMacros(entry: FoodEntry): Macros {
  const f = measurementFactor(entry, entry.quantity, entry.unit);
  // An entry that cannot resolve contributes nothing rather than throwing: the
  // day still has to render, and the offending row shows its own error state.
  if (!f.ok) return {};
  return scaleMacros(entry, f.factor);
}

/** Sums entries. `undefined` only survives when NO entry supplied that field. */
export function sumMacros(list: readonly Macros[]): Macros {
  const out: Macros = {};
  const fields = ["calories", "protein", "carbs", "fat"] as const;
  for (const field of fields) {
    let total = 0;
    let seen = false;
    for (const m of list) {
      const v = m[field];
      if (v == null) continue;
      total += v;
      seen = true;
    }
    if (seen) out[field] = total;
  }
  return out;
}

// --- The day resolver -----------------------------------------------------

/** Which way a day's macros were arrived at. Rendered, so the user is never guessing. */
export type DayMacroSource = "entries" | "typed" | "none";

export interface ResolvedDayMacros extends Macros {
  source: DayMacroSource;
}

/**
 * The macros for one day, and the single place that question is answered.
 *
 * Decision 6, in one function: a day with any food entry is entry-based and its
 * typed `DailyLog` macros are ignored; a day with none behaves exactly as it
 * always has. Today, the charts and the sheet push all route through here, or
 * they will disagree with each other.
 *
 * Note what is NOT merged: typed macros never top up a day that has entries.
 * An average of the two would be a number the user never entered and the app
 * never computed.
 */
export function resolveDayMacros(
  entries: readonly FoodEntry[],
  log: DailyLog | undefined,
): ResolvedDayMacros {
  if (entries.length > 0) {
    return { ...sumMacros(entries.map(entryMacros)), source: "entries" };
  }
  if (
    log &&
    (log.calories != null || log.protein != null || log.carbs != null || log.fat != null)
  ) {
    return {
      calories: log.calories,
      protein: log.protein,
      carbs: log.carbs,
      fat: log.fat,
      source: "typed",
    };
  }
  return { source: "none" };
}

/** Every day's entries, keyed by date. Built once and reused. */
export function entriesByDate(entries: readonly FoodEntry[]): Map<string, FoodEntry[]> {
  const out = new Map<string, FoodEntry[]>();
  for (const e of entries) {
    const list = out.get(e.date);
    if (list) list.push(e);
    else out.set(e.date, [e]);
  }
  return out;
}

/**
 * The daily logs as the rest of the app should see them, with derived macros
 * substituted in on every day that has food entries.
 *
 * This exists so that Today, the charts, the weekly averages and the sheet push
 * cannot disagree about what a day's calories are. They all consume `DailyLog[]`
 * already, so projecting rather than teaching each of them about food entries
 * keeps decision 6 in exactly one place.
 *
 * Two things it deliberately preserves:
 * - `steps`, `bodyweight` and `isCheatDay` are never derived and always come
 *   from the stored row. Food logging has no opinion about them.
 * - A day with entries but no stored row still appears, because otherwise
 *   logging food without touching the day editor would leave the day invisible
 *   to the charts.
 */
export function effectiveDailyLogs(
  logs: readonly DailyLog[],
  entries: readonly FoodEntry[],
): DailyLog[] {
  const byDate = entriesByDate(entries);
  const byLogDate = new Map(logs.map((l) => [l.date, l]));
  const dates = new Set<string>([...byLogDate.keys(), ...byDate.keys()]);

  const out: DailyLog[] = [];
  for (const date of dates) {
    const stored = byLogDate.get(date);
    const dayEntries = byDate.get(date);
    if (!dayEntries || dayEntries.length === 0) {
      if (stored) out.push(stored);
      continue;
    }
    const derived = sumMacros(dayEntries.map(entryMacros));
    out.push({
      ...(stored ?? { date }),
      calories: derived.calories,
      protein: derived.protein,
      carbs: derived.carbs,
      fat: derived.fat,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Groups a day's entries by meal, in `rank` order, including empty meals. */
export function entriesByMeal(
  meals: readonly Meal[],
  entries: readonly FoodEntry[],
): { meal: Meal; entries: FoodEntry[] }[] {
  const byMeal = new Map<string, FoodEntry[]>();
  for (const e of entries) {
    const list = byMeal.get(e.mealId);
    if (list) list.push(e);
    else byMeal.set(e.mealId, [e]);
  }
  return [...meals]
    .sort((a, b) => a.rank - b.rank)
    .map((meal) => ({
      meal,
      entries: (byMeal.get(meal.id) ?? []).sort((a, b) => a.loggedAt - b.loggedAt),
    }));
}

/**
 * The meal whose window contains `minutes`, or the first meal as a fallback.
 *
 * Decision 5: this is the whole reason meals store a time window. An all-day
 * meal (`from === to`) never wins, or it would swallow every other slot.
 */
export function mealForTime(meals: readonly Meal[], minutes: number): Meal | undefined {
  const ordered = [...meals].sort((a, b) => a.rank - b.rank);
  const hit = ordered.find((m) => {
    if (m.fromMinutes === m.toMinutes) return false;
    // A window that wraps past midnight ("Late snack", 22:00 to 02:00) is two
    // ranges, not one, so test it as such.
    if (m.fromMinutes < m.toMinutes) return minutes >= m.fromMinutes && minutes < m.toMinutes;
    return minutes >= m.fromMinutes || minutes < m.toMinutes;
  });
  return hit ?? ordered[0];
}

/** Minutes since local midnight, for `mealForTime`. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** The default meals seeded on first run. User-owned from that moment on. */
export const DEFAULT_MEALS: readonly Omit<Meal, "id">[] = [
  { name: "Breakfast", fromMinutes: 5 * 60, toMinutes: 11 * 60, rank: 0 },
  { name: "Lunch", fromMinutes: 11 * 60, toMinutes: 15 * 60, rank: 1 },
  { name: "Dinner", fromMinutes: 17 * 60, toMinutes: 22 * 60, rank: 2 },
  { name: "Snacks", fromMinutes: 0, toMinutes: 0, rank: 3 },
] as const;

/** How a portion reads in the UI: "3 cake", "150 g", "1 serving". */
export function formatMeasurement(
  basis: MacroBasis,
  quantity: number,
  unit: MeasurementUnit,
): string {
  const n = Number.isInteger(quantity)
    ? String(quantity)
    : String(Math.round(quantity * 100) / 100);
  if (unit === "serving") {
    const label = basis.servingLabel ?? "serving";
    return `${n} ${label}`;
  }
  if (unit === "package") return `${n} package`;
  return `${n} ${UNIT_LABELS[unit]}`;
}
