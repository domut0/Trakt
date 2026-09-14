import type { CellValue } from "./csv";
import type { NutritionPhaseKind, SplitCardKind } from "./planning";
import type { Exercise, SplitSlot } from "./store";
import type { NutritionPhase, PlannedDay } from "./planning";

/**
 * The `plan` tab: a training and nutrition plan, in a form that survives the
 * trip between two devices that share no ids.
 *
 * ## Why this tab exists
 *
 * The sheet carries `sets`, `sessions`, `daily` and `cardio` (see
 * `buildSheetTabs`). A plan -- nutrition phases, split cards, pinned days --
 * never leaves the device it was written on. So a coach has nothing to read a
 * client's current plan from, and nowhere to write a new one. This is that
 * channel, and it is deliberately the SAME channel the log already uses: the
 * client's own spreadsheet, in the client's own Drive, which both sides already
 * have access to.
 *
 * ## No ids cross the wire
 *
 * This is the single rule the format is built around, and every other decision
 * here follows from it.
 *
 * `SplitSlot.id`, `NutritionPhase.id` and `Exercise.id` are device-local. A
 * plan authored on the coach's phone refers to the coach's exercise records,
 * which mean nothing on the client's. Carrying them would produce a plan that
 * parses cleanly and points at nothing.
 *
 * So identity travels as the thing a human would use:
 *
 *   a phase    is identified by `startsOn`, which is already unique by
 *              construction -- two phases starting on one day is a
 *              contradiction the app refuses to store
 *   a card     is identified by its name
 *   a pin      is identified by its date, and names the card it points to
 *   an exercise is identified by its name
 *
 * The receiving side maps those back to its own ids. That is what preserves
 * history across an accepted plan: matching a card by NAME lets the client keep
 * the slot id its existing `WorkoutSession`s already reference, where adopting
 * the author's ids would orphan every workout ever logged against that card.
 *
 * ## The two meta rows
 *
 * `issuedBy` and `issuedAt` are the entire conflict rule. Both sides write this
 * tab -- the client pushes its current plan so the coach has something to read,
 * the coach writes a replacement -- and a plan is applied only when it was
 * issued by a coach, later than the last one accepted. That is what stops an
 * old link, or a sync that arrives out of order, from reinstating a plan the
 * client has already moved past.
 */

export const PLAN_TAB = "plan";

/** A nutrition phase, keyed by its start date rather than an id. */
export interface PlanPhase {
  /** Local "yyyy-MM-dd". The identity of the phase. */
  startsOn: string;
  name: string;
  kind: NutritionPhaseKind;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

/** A split card, keyed by name, with its lifts carried as names. */
export interface PlanCard {
  name: string;
  rotationOrder: number;
  kind: SplitCardKind;
  exerciseNames: string[];
}

/** A pinned day, naming the card it pins rather than pointing at an id. */
export interface PlanPin {
  /** Local "yyyy-MM-dd". */
  date: string;
  cardName: string;
}

export interface PlanPayload {
  phases: PlanPhase[];
  cards: PlanCard[];
  pins: PlanPin[];
  /** Who wrote this plan. Only a coach-issued plan is offered to a client. */
  issuedBy: "coach" | "client";
  /** ISO instant. Orders two plans; a stale one is never applied over a newer. */
  issuedAt: string;
}

// --- Columns --------------------------------------------------------------
//
// One tab holding four row shapes, discriminated by column A. Three tabs for a
// few dozen rows would be three times the plumbing -- three reads, three
// header checks, three ways for the set to be internally inconsistent -- to
// express something that fits on one screen.

const HEADERS = [
  "Kind",
  "Name",
  "Date",
  "Value",
  "Calories",
  "Protein (g)",
  "Carbs (g)",
  "Fat (g)",
  "Steps",
  "Order",
  "Card Kind",
  "Exercises",
] as const;

type Header = (typeof HEADERS)[number];

/** Separates exercise names in the `Exercises` cell. */
const EXERCISE_SEPARATOR = " | ";

const MACRO_HEADERS: Array<[keyof PlanPhase, Header]> = [
  ["calories", "Calories"],
  ["protein", "Protein (g)"],
  ["carbs", "Carbs (g)"],
  ["fat", "Fat (g)"],
  ["steps", "Steps"],
];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// --- Build ----------------------------------------------------------------

function blankRow(): CellValue[] {
  return HEADERS.map(() => undefined);
}

function at(row: CellValue[], header: Header, value: CellValue): void {
  row[HEADERS.indexOf(header)] = value;
}

/**
 * The tab, ready to write.
 *
 * Row order is meta, phases, cards, pins -- chronological within phases and
 * pins, cycle order within cards. Nothing reads the order back (every row
 * carries its own key), but a spreadsheet is a thing people open, and a plan
 * that reads top to bottom is worth the sort.
 */
export function buildPlanTab(plan: PlanPayload): CellValue[][] {
  const rows: CellValue[][] = [HEADERS.map((h) => h as CellValue)];

  const meta = (name: string, value: CellValue): void => {
    const row = blankRow();
    at(row, "Kind", "meta");
    at(row, "Name", name);
    at(row, "Value", value);
    rows.push(row);
  };
  meta("issuedBy", plan.issuedBy);
  meta("issuedAt", plan.issuedAt);

  for (const phase of [...plan.phases].sort((a, b) => a.startsOn.localeCompare(b.startsOn))) {
    const row = blankRow();
    at(row, "Kind", "phase");
    at(row, "Name", phase.name);
    at(row, "Date", phase.startsOn);
    at(row, "Value", phase.kind);
    for (const [field, header] of MACRO_HEADERS) {
      at(row, header, phase[field] as CellValue);
    }
    rows.push(row);
  }

  for (const card of [...plan.cards].sort((a, b) => a.rotationOrder - b.rotationOrder)) {
    const row = blankRow();
    at(row, "Kind", "card");
    at(row, "Name", card.name);
    at(row, "Order", card.rotationOrder);
    at(row, "Card Kind", card.kind);
    // An empty list writes a blank cell rather than an empty string, so a card
    // with no lifts round-trips as absent rather than as one nameless exercise.
    at(
      row,
      "Exercises",
      card.exerciseNames.length > 0 ? card.exerciseNames.join(EXERCISE_SEPARATOR) : undefined,
    );
    rows.push(row);
  }

  for (const pin of [...plan.pins].sort((a, b) => a.date.localeCompare(b.date))) {
    const row = blankRow();
    at(row, "Kind", "pin");
    at(row, "Name", pin.cardName);
    at(row, "Date", pin.date);
    rows.push(row);
  }

  return rows;
}

// --- Reading the app's own state into a payload ---------------------------

export interface PlanSource {
  slots: readonly SplitSlot[];
  exercises: readonly Exercise[];
  nutritionPhases: readonly NutritionPhase[];
  plannedDays: readonly PlannedDay[];
}

/**
 * The current plan, as a payload.
 *
 * Drops a pin whose slot no longer exists rather than writing a pin that names
 * nothing: a dangling pin is not information the other side can act on, and
 * `parsePlanTab` would refuse the whole tab for it.
 *
 * An exercise id that matches no record is dropped for the same reason. Both
 * are states the store should not reach, but this function runs on every sync
 * and refusing to serialise is a worse failure than quietly omitting a row.
 */
export function planFromStore(
  source: PlanSource,
  issued: { by: "coach" | "client"; at: string },
): PlanPayload {
  const exerciseNameById = new Map(source.exercises.map((e) => [e.id, e.name]));
  const slotNameById = new Map(source.slots.map((s) => [s.id, s.name]));

  return {
    phases: source.nutritionPhases.map((p) => ({
      startsOn: p.startsOn,
      name: p.name,
      kind: p.kind,
      calories: p.calories,
      protein: p.protein,
      carbs: p.carbs,
      fat: p.fat,
      steps: p.steps,
    })),
    cards: source.slots.map((s) => ({
      name: s.name,
      rotationOrder: s.rotationOrder,
      kind: s.kind ?? "workout",
      exerciseNames: (s.plannedExerciseIds ?? [])
        .map((id) => exerciseNameById.get(id))
        .filter((name): name is string => name !== undefined),
    })),
    pins: source.plannedDays
      .map((p) => ({ date: p.date, cardName: slotNameById.get(p.splitSlotId) }))
      .filter((p): p is PlanPin => p.cardName !== undefined),
    issuedBy: issued.by,
    issuedAt: issued.at,
  };
}

// --- Parse ----------------------------------------------------------------

/**
 * Cell readers.
 *
 * `text` collapses every way a cell can be empty into undefined, the same way
 * `normalise` does in sync.ts and for the same reason: Apps Script hands back
 * `""` for a blank cell while the app holds `undefined`, and without this every
 * blank would read as a value.
 */
function text(value: CellValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

/**
 * A number, or a marker that the cell held something that is not one.
 *
 * The distinction matters: a blank target is "not set", which is ordinary, but
 * `"about 3000"` in a calorie cell is corruption, and treating the two alike
 * would silently drop a target the author believed they had written.
 */
const BAD = Symbol("bad-number");

function num(value: CellValue): number | undefined | typeof BAD {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(raw);
  // Negative and non-finite are both corruption rather than intent: there is no
  // such thing as a -200 calorie target, and NaN propagates through every
  // total that touches it.
  if (!Number.isFinite(n) || n < 0) return BAD;
  return n;
}

function indexHeaders(rows: readonly CellValue[][]): Map<string, number> | undefined {
  const first = rows[0];
  if (!first) return undefined;
  const map = new Map<string, number>();
  first.forEach((cell, i) => {
    const name = text(cell);
    if (name !== undefined) map.set(name, i);
  });
  // Looked up by name rather than position, because inserting a column is an
  // ordinary thing to do to a spreadsheet and a positional read would quietly
  // start parsing the wrong values the moment someone did.
  for (const required of ["Kind", "Name"] as const) {
    if (!map.has(required)) return undefined;
  }
  return map;
}

/**
 * The plan a tab describes, or undefined when it does not describe one.
 *
 * Refuses the WHOLE tab on any malformed row of a kind it recognises, following
 * what `parseBackup` already promises: a key that is present but wrong is a hard
 * failure. A partially applied plan is the one outcome worth ruling out
 * entirely -- it would leave someone following a programme neither side wrote.
 *
 * A row whose `Kind` is unrecognised is SKIPPED rather than refused, which is
 * the one deliberate asymmetry. That is forward compatibility: a later version
 * adding a row type must not brick every client that has not updated yet.
 */
export function parsePlanTab(rows: readonly CellValue[][] | undefined): PlanPayload | undefined {
  if (!rows || rows.length === 0) return undefined;
  const headers = indexHeaders(rows);
  if (!headers) return undefined;

  const cell = (row: readonly CellValue[], header: Header): CellValue => {
    const i = headers.get(header);
    return i === undefined ? undefined : row[i];
  };

  const phases: PlanPhase[] = [];
  const cards: PlanCard[] = [];
  const pins: PlanPin[] = [];
  let issuedBy: "coach" | "client" | undefined;
  let issuedAt: string | undefined;

  const seenPhaseDates = new Set<string>();
  const seenCardNames = new Set<string>();
  const seenPinDates = new Set<string>();

  for (const row of rows.slice(1)) {
    const kind = text(cell(row, "Kind"))?.toLowerCase();
    if (kind === undefined) continue; // A blank spacer row is not an error.

    if (kind === "meta") {
      const name = text(cell(row, "Name"));
      const value = text(cell(row, "Value"));
      if (name === "issuedBy") {
        if (value !== "coach" && value !== "client") return undefined;
        issuedBy = value;
      } else if (name === "issuedAt") {
        if (value === undefined || Number.isNaN(Date.parse(value))) return undefined;
        issuedAt = value;
      }
      continue;
    }

    if (kind === "phase") {
      const startsOn = text(cell(row, "Date"));
      const name = text(cell(row, "Name"));
      const phaseKind = text(cell(row, "Value"));
      if (startsOn === undefined || !DAY_KEY.test(startsOn)) return undefined;
      if (name === undefined) return undefined;
      if (phaseKind !== "targets" && phaseKind !== "untracked") return undefined;
      // Two phases starting on one day is a contradiction, not something to
      // resolve with a tiebreak nobody would remember -- the same reason
      // `setPhaseStart` refuses it.
      if (seenPhaseDates.has(startsOn)) return undefined;
      seenPhaseDates.add(startsOn);

      const phase: PlanPhase = { startsOn, name, kind: phaseKind };
      for (const [field, header] of MACRO_HEADERS) {
        const n = num(cell(row, header));
        if (n === BAD) return undefined;
        if (n !== undefined) (phase[field] as number | undefined) = n;
      }
      phases.push(phase);
      continue;
    }

    if (kind === "card") {
      const name = text(cell(row, "Name"));
      if (name === undefined) return undefined;
      // Names are the identity, so two cards sharing one is a plan that cannot
      // be resolved to a split.
      if (seenCardNames.has(name.toLowerCase())) return undefined;
      seenCardNames.add(name.toLowerCase());

      const order = num(cell(row, "Order"));
      if (order === BAD || order === undefined) return undefined;

      const cardKind = text(cell(row, "Card Kind")) ?? "workout";
      if (cardKind !== "workout" && cardKind !== "rest" && cardKind !== "repeat") return undefined;

      const exercises = text(cell(row, "Exercises"));
      const exerciseNames =
        exercises === undefined
          ? []
          : exercises
              .split("|")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);

      cards.push({ name, rotationOrder: order, kind: cardKind, exerciseNames });
      continue;
    }

    if (kind === "pin") {
      const date = text(cell(row, "Date"));
      const cardName = text(cell(row, "Name"));
      if (date === undefined || !DAY_KEY.test(date)) return undefined;
      if (cardName === undefined) return undefined;
      if (seenPinDates.has(date)) return undefined; // One pin per day, by construction.
      seenPinDates.add(date);
      pins.push({ date, cardName });
      continue;
    }

    // Unrecognised kind: forward compatibility, see the doc comment.
  }

  // Without both meta rows there is no way to tell who wrote this or when, and
  // the ordering rule that keeps a stale plan from being reapplied has nothing
  // to compare. An unattributed plan is not one this app will act on.
  if (issuedBy === undefined || issuedAt === undefined) return undefined;

  // A pin naming a card the plan does not contain points at nothing once the
  // ids are resolved, so it is corruption rather than an omission to tolerate.
  const cardNames = new Set(cards.map((c) => c.name.toLowerCase()));
  for (const pin of pins) {
    if (!cardNames.has(pin.cardName.toLowerCase())) return undefined;
  }

  return { phases, cards, pins, issuedBy, issuedAt };
}

/**
 * Whether `candidate` should replace `current`.
 *
 * The whole application rule, in one place so that no caller has to re-derive
 * it. A client-issued plan is never offered back to the client that wrote it,
 * and a plan no newer than the one already accepted is not a new plan -- which
 * is what makes re-reading the tab on every sync idempotent, and what stops a
 * stale copy from reinstating superseded targets.
 */
export function isNewerCoachPlan(
  candidate: PlanPayload,
  lastAcceptedAt: string | undefined,
): boolean {
  if (candidate.issuedBy !== "coach") return false;
  if (lastAcceptedAt === undefined) return true;
  const candidateAt = Date.parse(candidate.issuedAt);
  const acceptedAt = Date.parse(lastAcceptedAt);
  if (Number.isNaN(candidateAt)) return false;
  if (Number.isNaN(acceptedAt)) return true;
  return candidateAt > acceptedAt;
}
