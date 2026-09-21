/**
 * Planning, which in this app is two different shapes and not one.
 *
 * NUTRITION IS A CALENDAR. "I'm cutting from Sunday until the meet" is a pair
 * of dates. So it is a timeline of dated stretches, which may have gaps between
 * them, because not every week belongs to a plan.
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
 * One stretch of the nutrition timeline, with a beginning and an end.
 *
 * It used to be a change-point: a start date and nothing else, each phase
 * running until the next one began. That made the timeline continuous BY
 * CONSTRUCTION, which sounds like a virtue and was actually a claim the data
 * could not back - it meant the app always had an answer for what you were
 * aiming at, including for the months between two diets when the honest answer
 * was "nothing". A day covered by no phase is now a real state, and it reads as
 * no targets.
 *
 * `endsOn` is INCLUSIVE and optional. Absent means ongoing, which is the normal
 * state of the phase you are currently in: you know when a cut started and not
 * when it will end, and being made to invent a date would be the app asking for
 * a fact to satisfy its own schema.
 *
 * There is no `kind`. A phase used to be able to be "untracked", carrying no
 * targets, which was how a deliberate day off was expressed. Not having targets
 * expresses that on its own.
 */
export interface NutritionPhase {
  id: string;
  /** Local "yyyy-MM-dd". Zero-padded, so lexicographic order IS date order. */
  startsOn: string;
  /** Local "yyyy-MM-dd", INCLUSIVE. Absent means the phase is still running. */
  endsOn?: string;
  name: string;
  /**
   * Free text hung on the phase, and the reason a phase is worth opening.
   *
   * Written by a coach more often than by the person training: "keep protein
   * up on rest days, we'll reassess after the meet". It travels with the plan,
   * so it arrives attached to the weeks it is about rather than in a message
   * that has to be found again later.
   */
  note?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

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
 * The phase covering `date`, or undefined when none does.
 *
 * This is the whole resolution algorithm, and `undefined` is a first-class
 * answer rather than an error: before the first phase was ever recorded, after
 * one ended, and in the months between two diets, there is genuinely nothing
 * being aimed at. It reads as "no targets" everywhere it surfaces.
 *
 * An open-ended phase covers every day from its start. Two phases cannot cover
 * the same day - `addPhase` and the date setters refuse a range that overlaps
 * an existing one - but the latest start still wins if malformed data ever
 * arrives from a backup file, because picking the newer instruction is the less
 * surprising of the two wrong answers.
 */
export function phaseForDate(
  phases: readonly NutritionPhase[],
  date: string,
): NutritionPhase | undefined {
  let best: NutritionPhase | undefined;
  for (const p of phases) {
    if (p.startsOn > date) continue;
    if (p.endsOn !== undefined && p.endsOn < date) continue;
    if (!best || p.startsOn > best.startsOn) best = p;
  }
  return best;
}

/**
 * Whether two phases would cover any of the same days.
 *
 * Overlap is refused rather than resolved. Two rows both claiming Tuesday is a
 * contradiction the user has to settle, and settling it for them with a
 * tiebreak nobody would remember is how a plan ends up quietly meaning
 * something other than what it says.
 *
 * Open ends are the exception, and they are handled by the caller rather than
 * here: an absent `endsOn` is not an assertion about the future, so a phase
 * starting inside an open-ended one closes it instead of colliding with it.
 */
export function phasesOverlap(a: NutritionPhase, b: NutritionPhase): boolean {
  const aEnd = a.endsOn ?? MAX_DAY_KEY;
  const bEnd = b.endsOn ?? MAX_DAY_KEY;
  return a.startsOn <= bEnd && b.startsOn <= aEnd;
}

/** Later than any date a person will type into this app, and still sorting
 *  lexicographically as a day key. Stands in for "no end". */
const MAX_DAY_KEY = "9999-12-31";

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
  // Optional, and an end before the start is not a phase. A file written by a
  // build that predates end dates simply has none, which reads as ongoing -
  // and the import fills them in from the next phase's start, the same way the
  // stored timeline was migrated.
  if (p.endsOn !== undefined) {
    if (typeof p.endsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.endsOn)) return false;
    if (p.endsOn < p.startsOn) return false;
  }
  if (p.note !== undefined && typeof p.note !== "string") return false;
  for (const f of ["calories", "protein", "carbs", "fat", "steps"] as const) {
    if (p[f] !== undefined && typeof p[f] !== "number") return false;
  }
  return true;
}

/**
 * Give every phase but the last an end, from the one that follows it.
 *
 * The timeline used to be continuous by construction, so stored phases carry no
 * end at all. Read literally under the new rules that makes each of them
 * open-ended and therefore overlapping every phase after it, which is exactly
 * the state the editor refuses to let you create. This derives the ends the old
 * shape implied - the day before the next phase began - and leaves the most
 * recent phase running, which is what it was.
 *
 * Idempotent: a phase that already has an end keeps it.
 */
export function closeOpenPhases(phases: readonly NutritionPhase[]): NutritionPhase[] {
  const sorted = sortPhases(phases);
  return sorted.map((phase, i) => {
    if (phase.endsOn !== undefined) return phase;
    const next = sorted[i + 1];
    if (!next) return phase;
    return { ...phase, endsOn: addDaysToKey(next.startsOn, -1) };
  });
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
export type SplitCardKind = "workout" | "rest" | "repeat" | "cardio";

/**
 * A card that occupies a day, as against one that only redirects the cursor.
 *
 * `repeat` is the only kind that is not a day. Everything else - a workout, a
 * rest, a cardio session - is something you spend a day on, and spending it
 * moves the rotation forward.
 */
export function isDayCard(card: SplitCardLike): boolean {
  return kindOf(card) !== "repeat";
}

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

/**
 * The card a weekday holds, in `week` mode.
 *
 * A weekly plan means "Upper on Mondays", so a day with nothing on it is a day
 * with nothing on it: a missed Monday does not roll forward to Tuesday. Rolling
 * it forward would be the rotation again, wearing a calendar's clothes, and by
 * Friday the app would be showing Tuesday's workout.
 */
export function cardForWeekday<T extends SplitCardLike & { weekday?: number }>(
  cards: readonly T[],
  weekday: number,
): T | undefined {
  return cards.find((c) => c.weekday === weekday && kindOf(c) !== "repeat");
}

/**
 * Monday first, and cards on no day at all last.
 *
 * JavaScript numbers Sunday 0, which puts it in front of Monday in a naive
 * sort - so a week read back into a cycle used to start on Sunday, while the
 * planner that wrote it starts on Monday. Same week, two different orders.
 */
function mondayFirst(weekday: number | undefined): number {
  return weekday === undefined ? 7 : (weekday + 6) % 7;
}

/**
 * The same cards, rearranged for the other planning mode.
 *
 * Nothing is created or deleted: switching mode changes how the split is
 * ARRANGED, never what is in it, so every card - and every session logged
 * against it - survives the trip either way.
 *
 * To `week`: day cards land on consecutive days from Monday, because a week has
 * to start somewhere and Monday is where a programme is usually written from.
 * To `rotation`: cards take cycle order from the days they were on, and the
 * weekday is cleared.
 *
 * ## Repeats are kept, not dropped
 *
 * A week repeats by definition, so a repeat card has nothing to say while a
 * week is on screen and nothing renders it there. It is still carried through
 * the conversion, because dropping it means someone who looks at the other mode
 * once comes back to a cycle they have to rebuild by hand - and `Upper, Lower,
 * Repeat, Rest, Repeat` is five cards of which two would be gone.
 *
 * Coming back, each repeat returns to the day card it followed rather than to
 * an index: the week is free to have reordered those cards, and a repeat's
 * whole meaning is which card it sits behind.
 */
export function convertSplit<T extends SplitCardLike & { weekday?: number }>(
  cards: readonly T[],
  to: "week" | "rotation",
): T[] {
  const inOrder = orderedSplit(cards);

  if (to === "rotation") {
    // Which day card each repeat followed. A repeat at the very top of the
    // cycle followed nothing, and stays at the top.
    const head: T[] = [];
    const following = new Map<string, T[]>();
    let previousDay: string | undefined;
    for (const card of inOrder) {
      if (isDayCard(card)) {
        previousDay = card.id;
        continue;
      }
      if (previousDay === undefined) {
        head.push(card);
        continue;
      }
      const trailing = following.get(previousDay);
      if (trailing) trailing.push(card);
      else following.set(previousDay, [card]);
    }

    const days = inOrder
      .filter(isDayCard)
      .sort(
        (a, b) =>
          mondayFirst(a.weekday) - mondayFirst(b.weekday) || a.rotationOrder - b.rotationOrder,
      );

    const out: T[] = [...head];
    for (const day of days) {
      out.push(day);
      const trailing = following.get(day.id);
      if (trailing) out.push(...trailing);
    }
    return out.map((card, i) => ({ ...card, rotationOrder: i, weekday: undefined }));
  }

  // Monday first, wrapping to Sunday: 1..6 then 0.
  const week = [1, 2, 3, 4, 5, 6, 0];
  let dayIndex = 0;
  return inOrder.map((card, i) => {
    if (!isDayCard(card)) return { ...card, rotationOrder: i, weekday: undefined };
    const weekday = dayIndex < week.length ? week[dayIndex] : undefined;
    dayIndex += 1;
    return { ...card, rotationOrder: i, weekday };
  });
}

/** The first day card, for a split with no cursor yet. */
export function firstDayCard<T extends SplitCardLike>(cards: readonly T[]): T | undefined {
  return orderedSplit(cards).find((c) => kindOf(c) !== "repeat");
}

// ---------------------------------------------------------------------------
// Day arithmetic. Day keys are the app's date type, so this works on the keys
// themselves through Date.UTC rather than through local Date objects: a
// difference in local time can be 23 or 25 hours across a DST boundary, and
// "how many days is this phase" must never be off by one because the clocks
// changed inside it.
// ---------------------------------------------------------------------------

function toUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** `key` moved by `n` days, as a day key. */
export function addDaysToKey(key: string, n: number): string {
  return new Date(toUtcMs(key) + n * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The ribbon: the nutrition timeline, drawn.
// ---------------------------------------------------------------------------

/**
 * How wide a stretch of time is drawn.
 *
 * The ribbon does NOT fit itself to the screen. A fitted timeline is unusable
 * the moment one phase is much longer than the others - a bulk running through
 * all of 2027 beside a twelve-day deload would leave the deload two pixels
 * wide - and that is exactly the shape a real plan takes. So the ribbon scrolls,
 * and each stretch is drawn at true scale BETWEEN A FLOOR AND A CEILING:
 *
 *   the floor keeps a one-day stretch big enough to read and to tap
 *   the ceiling stops any one of them from eating the whole ribbon
 *
 * A segment that hits the ceiling is drawn with a visible break and prints its
 * real length, so the scale is broken openly rather than quietly lied about.
 * That is the whole trick: honest where it can be, and marked where it can't.
 */
export const RIBBON = {
  MIN_W: 52,
  MAX_W: 168,
  PX_PER_DAY: 4.5,
  /** An open-ended phase has no length, so it gets a fixed tail instead. */
  TAIL_W: 128,
} as const;

/**
 * One drawn stretch: either a phase, or the space between two of them.
 *
 * A GAP IS A REAL SEGMENT, with a width taken from its real length like any
 * other. The old ribbon could not have one - phases ran until the next began,
 * so the timeline was continuous by construction - and drawing the new model
 * without them would put two phases shoulder to shoulder and claim a plan runs
 * straight through a month that nothing covers.
 */
export interface RibbonSegment {
  /** The phase this segment draws, or undefined when it is a gap. */
  phase?: NutritionPhase;
  /** Left edge, px from the start of the ribbon. */
  x: number;
  width: number;
  /** Days covered, or undefined for an open-ended phase. */
  days?: number;
  /** True when the drawn width is smaller than the true duration. */
  capped: boolean;
  /** This phase runs until something replaces it. */
  open: boolean;
}

/**
 * Lay the timeline out end to end, gaps included.
 *
 * Gaps are measured from the previous phase's END, which is the field that did
 * not exist when this function was first written. A phase with no end swallows
 * everything after it, so a gap can only ever follow a closed one.
 */
export function layoutRibbon(phases: readonly NutritionPhase[]): RibbonSegment[] {
  const ordered = sortPhases(phases);
  const segments: RibbonSegment[] = [];
  let x = 0;

  const push = (seg: Omit<RibbonSegment, "x">): void => {
    segments.push({ ...seg, x });
    x += seg.width;
  };

  const sized = (days: number): { width: number; capped: boolean } => {
    const ideal = days * RIBBON.PX_PER_DAY;
    const width = Math.min(RIBBON.MAX_W, Math.max(RIBBON.MIN_W, ideal));
    return { width, capped: ideal > width };
  };

  ordered.forEach((phase, i) => {
    const prev = ordered[i - 1];
    // The day after the previous phase ended, up to the day before this one
    // starts. Only a closed previous phase can leave one.
    if (prev?.endsOn !== undefined) {
      const gapDays = daysBetweenKeys(prev.endsOn, phase.startsOn) - 1;
      if (gapDays > 0) push({ ...sized(gapDays), days: gapDays, open: false });
    }

    if (phase.endsOn === undefined) {
      push({ phase, width: RIBBON.TAIL_W, days: undefined, capped: false, open: true });
      return;
    }
    // Inclusive, so a phase that starts and ends on one day is one day long.
    const days = daysBetweenKeys(phase.startsOn, phase.endsOn) + 1;
    push({ phase, ...sized(days), days, open: false });
  });

  return segments;
}

/** Total drawn width of a laid-out ribbon. */
export function ribbonWidth(segments: readonly RibbonSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.x + last.width : 0;
}

/**
 * Where a date falls along the ribbon, in px, or undefined when it is outside
 * the drawn range entirely.
 *
 * Inside a capped segment this is only approximately right - it cannot be
 * otherwise, the segment is drawn shorter than it is - so it is clamped to stay
 * within the segment rather than running off the end of it.
 */
export function ribbonX(segments: readonly RibbonSegment[], date: string): number | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const start = s.phase?.startsOn;
    // A gap has no start date of its own; it is located by the segment before
    // it, so a date inside one resolves against that segment's geometry.
    if (start === undefined) continue;
    if (start > date) continue;
    const into = daysBetweenKeys(start, date);
    const perDay = s.days ? s.width / s.days : RIBBON.PX_PER_DAY;
    return s.x + Math.min(s.width, into * perDay);
  }
  return undefined;
}

/**
 * How long a phase is, in the largest unit that still reads as a duration.
 *
 * "11 weeks" is a length you can hold; "77 days" is arithmetic. Printed beside
 * a phase's dates, where the dates are the fact and this is the thing you
 * actually wanted to know from them.
 */
export function durationLabel(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30.44)} months`;
  const years = days / 365.25;
  return years < 1.75 ? "1 year" : `${Math.round(years * 10) / 10} years`;
}
