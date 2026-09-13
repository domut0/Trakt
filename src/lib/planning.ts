/**
 * Planning, which in this app is two different shapes and not one.
 *
 * NUTRITION IS A CALENDAR. "From Sunday onward I'm cutting" is a date, and it
 * holds until the next change. So it is a timeline of change-points.
 *
 * TRAINING IS A ROTATION. The user's split is UL×∞, which advances when he
 * TRAINS rather than when the date changes: skip a day and nothing shifts. So it
 * has no dates at all, and lives on the split slots (see `predictNextSlotName`
 * in store.ts, which already implements it).
 *
 * The seven-slot weekday array this replaced could hold neither, which is why it
 * was replaced. Everything here is pure: no store, no Dexie, no clock.
 */

/**
 * One change-point on the nutrition timeline.
 *
 * There is deliberately NO END DATE. A phase runs until the next one starts,
 * which is what makes "I'll be cutting from Sunday" a single row rather than a
 * range that has to be maintained, and what makes "repeat this across the weeks"
 * need no repeat feature: the phase already covers every day after it.
 *
 * `kind: "untracked"` is a phase carrying no targets. A single untracked
 * Saturday is therefore not a special case - it is an untracked phase that
 * happens to be superseded the next day.
 */
export interface NutritionPhase {
  id: string;
  /** Local "yyyy-MM-dd". Zero-padded, so lexicographic order IS date order. */
  startsOn: string;
  name: string;
  kind: NutritionPhaseKind;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

export type NutritionPhaseKind = "targets" | "untracked";

/**
 * A training day the user has pinned to a date, because sometimes you do know.
 *
 * The rotation fills every day without one, and is NEVER PROJECTED FORWARD: a
 * free choice after a rest day makes the future genuinely unknowable, and a plan
 * that is confidently wrong is worse than no plan. An unpinned future day shows
 * nothing, which is honest.
 */
export interface PlannedDay {
  /** Local "yyyy-MM-dd". The primary key: one pin per day, by construction. */
  date: string;
  splitSlotId: string;
}

/** Chronological, oldest first. Day keys are zero-padded, so this is a string
 * sort and needs no Date to travel through it. */
export function sortPhases(phases: readonly NutritionPhase[]): NutritionPhase[] {
  return [...phases].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/**
 * The phase in force on `date`: the latest one that did not start after it.
 *
 * This is the whole resolution algorithm. `undefined` means the date falls
 * before the first phase ever recorded, which is a real state - history logged
 * before any plan existed - and reads as "no targets", not as an error.
 *
 * Ties cannot happen: `setPhaseStart` refuses a date another phase already
 * occupies, because two phases starting on one day is a contradiction rather
 * than something to resolve with a tiebreak nobody would remember.
 */
export function phaseForDate(
  phases: readonly NutritionPhase[],
  date: string,
): NutritionPhase | undefined {
  let best: NutritionPhase | undefined;
  for (const p of phases) {
    if (p.startsOn > date) continue;
    if (!best || p.startsOn > best.startsOn) best = p;
  }
  return best;
}

/**
 * The targets in force on a date, or undefined when there are none.
 *
 * An untracked phase resolves to undefined rather than to a phase with empty
 * numbers, so every caller that asks "what am I aiming at" gets one answer for
 * both "no plan" and "deliberately not tracking". The difference between those
 * two matters for whether a day counts as a gap, and that is asked separately
 * through `isUntrackedOn`.
 */
export function targetsForDate(
  phases: readonly NutritionPhase[],
  date: string,
): NutritionPhase | undefined {
  const phase = phaseForDate(phases, date);
  return phase?.kind === "targets" ? phase : undefined;
}

/**
 * Whether a day is untracked, by either route.
 *
 * A PLANNED untracked day is derived here and never written to a `DailyLog`.
 * Writing the flag on the user's behalf, for a day they never opened, would be
 * the app inventing a record of a decision rather than reflecting one - and it
 * would make a plan change retroactively rewrite history. The stored flag stays
 * a fact the user set; this is the question every screen should actually ask.
 */
export function isUntrackedOn(
  phases: readonly NutritionPhase[],
  date: string,
  loggedFlag: boolean | undefined,
): boolean {
  if (loggedFlag === true) return true;
  return phaseForDate(phases, date)?.kind === "untracked";
}

/** The slot pinned to a date, if any. Pins are never inferred. */
export function pinnedSlotIdFor(pins: readonly PlannedDay[], date: string): string | undefined {
  return pins.find((p) => p.date === date)?.splitSlotId;
}

/**
 * Tolerant validation for one phase off a backup file.
 *
 * A hand-edited or older export should land with that phase dropped rather than
 * failing the whole import: the JSON export is the only backup that exists, so
 * refusing a file costs more than ignoring one bad row.
 */
export function isNutritionPhase(v: unknown): v is NutritionPhase {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id.length === 0) return false;
  if (typeof p.startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.startsOn)) return false;
  if (typeof p.name !== "string") return false;
  if (p.kind !== "targets" && p.kind !== "untracked") return false;
  for (const f of ["calories", "protein", "carbs", "fat", "steps"] as const) {
    if (p[f] !== undefined && typeof p[f] !== "number") return false;
  }
  return true;
}

/** Same tolerance, for a pin. */
export function isPlannedDay(v: unknown): v is PlannedDay {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
    typeof d.splitSlotId === "string" &&
    d.splitSlotId.length > 0
  );
}

// ---------------------------------------------------------------------------
// The workout split: an ordered list of cards the app walks, one at a time.
// ---------------------------------------------------------------------------

/**
 * What a card in the split is.
 *
 * `workout` and `rest` are both DAYS: each one is a thing you spend a day on,
 * and each advances the cursor when you consume it. `repeat` is not a day at
 * all - reaching it sends the cursor straight back to the top of the list, and
 * it is never shown as what you are doing today.
 *
 * Absent means `workout`, so every slot that existed before this needs no
 * migration.
 */
export type SplitCardKind = "workout" | "rest" | "repeat";

/** The shape `advanceSplit` reads. `SplitSlot` satisfies it. */
export interface SplitCardLike {
  id: string;
  rotationOrder: number;
  kind?: SplitCardKind;
}

export function kindOf(card: SplitCardLike): SplitCardKind {
  return card.kind ?? "workout";
}

/** Cycle order. */
export function orderedSplit<T extends SplitCardLike>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => a.rotationOrder - b.rotationOrder);
}

/**
 * The card after `fromId`, with repeats resolved.
 *
 * This is the whole split mechanic, and it is three rules:
 *
 *   1. Step forward one, wrapping at the end.
 *   2. Landing on a `repeat` sends you back to the FIRST card.
 *   3. A day is a `workout` or a `rest`, never a `repeat`.
 *
 * Which is what makes the user's UL-forever split expressible in five cards:
 * `Upper, Lower, Repeat, Rest, Repeat`. Advancing off Lower hits the first
 * repeat and bounces to Upper, so Rest is NEVER reached on its own - it is
 * there to be chosen deliberately, and advancing off it hits the second repeat
 * and bounces to Upper too.
 *
 * `undefined` when there is no day to land on: an empty split, or one made only
 * of repeats. The bounded walk below is what stops that being a hang rather
 * than a shrug.
 */
export function advanceSplit<T extends SplitCardLike>(
  cards: readonly T[],
  fromId: string | undefined,
): T | undefined {
  const ordered = orderedSplit(cards);
  if (ordered.length === 0) return undefined;

  const fromIdx = fromId ? ordered.findIndex((c) => c.id === fromId) : -1;
  let idx = fromIdx < 0 ? 0 : (fromIdx + 1) % ordered.length;

  // Bounded by the list length: a split of nothing but repeats would otherwise
  // bounce to the top and back forever. Every real split terminates on its
  // first day card, usually immediately.
  for (let steps = 0; steps <= ordered.length; steps++) {
    const card = ordered[idx];
    if (kindOf(card) !== "repeat") return card;
    // A repeat means "start again", not "skip one". If the first card is itself
    // a repeat we keep walking forward rather than sitting on it.
    idx = idx === 0 ? 1 % ordered.length : 0;
  }
  return undefined;
}

/** The first day card, for a split with no cursor yet. */
export function firstDayCard<T extends SplitCardLike>(cards: readonly T[]): T | undefined {
  return orderedSplit(cards).find((c) => kindOf(c) !== "repeat");
}
