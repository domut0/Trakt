import type { CellValue } from "./csv";
import type { SplitCardKind } from "./planning";
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

export type PlanningMode = "week" | "rotation";

/**
 * The plan format this build writes.
 *
 * Bumped when a field is ADDED that an older build would drop on the floor:
 * prescriptions and weekdays are exactly that, and an older client that read
 * this plan, applied what it understood and published the result would strip
 * the coach's programming back out. An app that meets a higher number refuses
 * the plan and says to update, rather than half-applying it.
 */
export const PLAN_FORMAT_VERSION = 3;

/** A nutrition phase, keyed by its start date rather than an id. */
export interface PlanPhase {
  /** Local "yyyy-MM-dd". The identity of the phase. */
  startsOn: string;
  /** Local "yyyy-MM-dd", INCLUSIVE. Absent means the phase is still running. */
  endsOn?: string;
  name: string;
  /** The coach's own words about these weeks, carried with the weeks. */
  note?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

/** One prescribed lift, named rather than pointed at. See `PlannedLift`. */
export interface PlanLift {
  name: string;
  sets?: number;
  reps?: string;
  load?: string;
}

/** A split card, keyed by name, with its lifts carried as names. */
export interface PlanCard {
  name: string;
  rotationOrder: number;
  kind: SplitCardKind;
  lifts: PlanLift[];
  /** 0 = Sunday. Present in `week` mode, absent in `rotation`. */
  weekday?: number;
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
  /**
   * How the split is arranged: a repeating week, or a rotation that advances
   * when you train. Part of the plan rather than a device setting, so a coach
   * chooses it per client and it travels with the plan they send.
   */
  mode: PlanningMode;
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
  // A phase's last day. Named "End" against "Date" rather than "Start Date" /
  // "End Date" because "Date" is the column every row kind uses for whatever
  // single date it has, and renaming it would rewrite rows that have nothing
  // to do with phases.
  "End",
  "Value",
  "Calories",
  "Protein (g)",
  "Carbs (g)",
  "Fat (g)",
  "Steps",
  "Order",
  "Card Kind",
  "Day",
  "Exercises",
] as const;

type Header = (typeof HEADERS)[number];

/** Separates lifts in the `Exercises` cell. */
const EXERCISE_SEPARATOR = " | ";

/** Sunday first, matching `Date.getDay()`, and written out so the sheet reads. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * One lift, as a person would write it: `Bench Press 3x8-12 @100kg`.
 *
 * The sheet is a readable rendering, not a serialisation, and a coach opening
 * it in Google Sheets should be able to read the programme off the screen and
 * type into it. The parser accepts what it writes plus the obvious variations
 * (`x` or `×`, en dash or hyphen, a missing load, a bare name).
 */
export function formatLift(lift: PlanLift): string {
  const parts = [lift.name.trim()];
  if (lift.sets !== undefined && lift.reps) parts.push(`${lift.sets}x${lift.reps}`);
  else if (lift.sets !== undefined) parts.push(`${lift.sets} sets`);
  else if (lift.reps) parts.push(`x${lift.reps}`);
  if (lift.load) parts.push(`@${lift.load}`);
  return parts.join(" ");
}

const LIFT =
  /^(.*?)\s+(?:(\d+)\s*(?:x|×)\s*([^@\s]+)|(\d+)\s+sets|(?:x|×)\s*([^@\s]+))\s*(?:@\s*(.*))?$/i;

/** The inverse of `formatLift`. A cell it cannot parse is taken as a bare name. */
export function parseLift(cell: string): PlanLift | undefined {
  const text = cell.trim();
  if (text === "") return undefined;

  const withLoad = /^(.*?)\s*@\s*(.+)$/.exec(text);
  const match = LIFT.exec(text);
  if (!match) {
    // No sets or reps, but possibly still a load: "Bench Press @100kg".
    if (withLoad && withLoad[1].trim() !== "") {
      return { name: withLoad[1].trim(), load: withLoad[2].trim() };
    }
    return { name: text };
  }
  const [, name, sets, reps, setsOnly, repsOnly, load] = match;
  if (name.trim() === "") return { name: text };
  return {
    name: name.trim(),
    ...((sets ?? setsOnly) ? { sets: Number(sets ?? setsOnly) } : {}),
    ...((reps ?? repsOnly) ? { reps: (reps ?? repsOnly).trim() } : {}),
    ...(load && load.trim() !== "" ? { load: load.trim() } : {}),
  };
}

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
  meta("mode", plan.mode);
  // Last of the meta rows, and the first thing the parser looks at.
  meta("version", PLAN_FORMAT_VERSION);

  for (const phase of [...plan.phases].sort((a, b) => a.startsOn.localeCompare(b.startsOn))) {
    const row = blankRow();
    at(row, "Kind", "phase");
    at(row, "Name", phase.name);
    at(row, "Date", phase.startsOn);
    at(row, "End", phase.endsOn);
    // The note rides in "Value", which is where a phase's kind used to sit.
    // Reusing the cell rather than adding a thirteenth column keeps the sheet
    // the same width, and a phase now has exactly one free-text field.
    at(row, "Value", phase.note);
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
    at(row, "Day", card.weekday === undefined ? undefined : WEEKDAYS[card.weekday]);
    // An empty list writes a blank cell rather than an empty string, so a card
    // with no lifts round-trips as absent rather than as one nameless exercise.
    at(
      row,
      "Exercises",
      card.lifts.length > 0 ? card.lifts.map(formatLift).join(EXERCISE_SEPARATOR) : undefined,
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
  planningMode: PlanningMode;
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
      endsOn: p.endsOn,
      name: p.name,
      note: p.note,
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
      ...(s.weekday === undefined ? {} : { weekday: s.weekday }),
      lifts: (s.plannedLifts ?? [])
        .map(({ exerciseId, sets, reps, load }): PlanLift | undefined => {
          const name = exerciseNameById.get(exerciseId);
          if (name === undefined) return undefined;
          return {
            name,
            ...(sets === undefined ? {} : { sets }),
            ...(reps === undefined ? {} : { reps }),
            ...(load === undefined ? {} : { load }),
          };
        })
        .filter((lift): lift is PlanLift => lift !== undefined),
    })),
    pins: source.plannedDays
      .map((p) => ({ date: p.date, cardName: slotNameById.get(p.splitSlotId) }))
      .filter((p): p is PlanPin => p.cardName !== undefined),
    mode: source.planningMode,
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
/**
 * The format version a plan tab declares, or 1 when it declares none.
 *
 * Deliberately far more tolerant than `parsePlanTab`: it walks the meta rows
 * for a version and ignores everything else, so it can still answer for a tab
 * whose phases or cards this build cannot read. That is the entire point - the
 * question it exists to answer is "did that fail because the app is old?", and
 * a parser strict enough to reject the tab cannot answer it.
 *
 * Returns undefined only when there is nothing here that resembles a plan tab
 * at all, which is a different thing from an unreadable one.
 */
export function planTabVersion(rows: readonly CellValue[][] | undefined): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  const headers = indexHeaders(rows);
  if (!headers) return undefined;

  const kindCol = headers.get("Kind");
  const nameCol = headers.get("Name");
  const valueCol = headers.get("Value");
  if (kindCol === undefined || nameCol === undefined || valueCol === undefined) return undefined;

  for (const row of rows.slice(1)) {
    if (String(row[kindCol] ?? "").toLowerCase() !== "meta") continue;
    if (String(row[nameCol] ?? "") !== "version") continue;
    const n = Number(String(row[valueCol] ?? "").trim());
    if (!Number.isFinite(n) || n < 1) return undefined;
    return n;
  }
  // No version row is version 1, the same assumption parsePlanTab makes.
  return 1;
}

/**
 * Whether a plan tab was written by a build newer than this one.
 *
 * The caller asks this AFTER `parsePlanTab` returns undefined, to tell the two
 * reasons for that apart: a plan this app is too old to read, which the person
 * can fix by updating, and a corrupt tab, which they cannot.
 */
export function planNeedsNewerApp(rows: readonly CellValue[][] | undefined): boolean {
  const version = planTabVersion(rows);
  return version !== undefined && version > PLAN_FORMAT_VERSION;
}

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
  // Absent is version 1: a plan written before prescriptions and week mode.
  let version = 1;
  let mode: PlanningMode | undefined;

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
      } else if (name === "mode") {
        if (value !== "week" && value !== "rotation") return undefined;
        mode = value;
      } else if (name === "version") {
        const n = num(cell(row, "Value"));
        if (n === BAD || n === undefined) return undefined;
        version = n;
      }
      continue;
    }

    if (kind === "phase") {
      const startsOn = text(cell(row, "Date"));
      const endsOn = text(cell(row, "End"));
      const name = text(cell(row, "Name"));
      const note = text(cell(row, "Value"));
      if (startsOn === undefined || !DAY_KEY.test(startsOn)) return undefined;
      if (name === undefined) return undefined;
      // An end is optional -- an ongoing phase has none -- but a malformed or
      // backwards one is a plan that cannot be applied, not a field to ignore.
      if (endsOn !== undefined && (!DAY_KEY.test(endsOn) || endsOn < startsOn)) return undefined;
      // Two phases starting on one day is a contradiction, not something to
      // resolve with a tiebreak nobody would remember -- the same reason
      // `setPhaseDates` refuses it.
      if (seenPhaseDates.has(startsOn)) return undefined;
      seenPhaseDates.add(startsOn);

      const phase: PlanPhase = { startsOn, name };
      if (endsOn !== undefined) phase.endsOn = endsOn;
      if (note !== undefined) phase.note = note;
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

      const day = text(cell(row, "Day"));
      const weekday = day === undefined ? undefined : WEEKDAYS.indexOf(day.slice(0, 3) as never);
      // A day column that says something this app cannot read is corruption,
      // not an omission: the card would silently land on no day at all.
      if (day !== undefined && weekday === -1) return undefined;

      const exercises = text(cell(row, "Exercises"));
      const lifts =
        exercises === undefined
          ? []
          : exercises
              .split("|")
              .map((part) => parseLift(part))
              .filter((lift): lift is PlanLift => lift !== undefined);

      cards.push({
        name,
        rotationOrder: order,
        kind: cardKind,
        lifts,
        ...(weekday === undefined || weekday < 0 ? {} : { weekday }),
      });
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

  // A plan from a newer build carries fields this one would drop on the floor,
  // and publishing what survived would strip them back out of the sheet. The
  // caller shows "update Trakt" rather than applying half a programme - see
  // `planNeedsNewerApp`, which is how the caller can tell this refusal from a
  // refusal for corruption. For a long time it could not, and a plan from a
  // newer build therefore vanished in silence.
  if (version > PLAN_FORMAT_VERSION) return undefined;

  return {
    phases,
    cards,
    pins,
    // A plan with no mode row predates week mode, and a plan written then is a
    // rotation: cards in a cycle, no weekdays.
    mode: mode ?? "rotation",
    issuedBy,
    issuedAt,
  };
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

// --- Resolving a plan onto this device ------------------------------------

/**
 * What a parsed plan becomes on the device accepting it.
 *
 * Returned rather than applied, so that every decision below is testable
 * without a store or a database, and so the review screen can show what is
 * about to happen before anything does. The caller feeds these through the
 * store's own actions, keeping the existing write path the only one.
 */
export interface PlanResolution {
  /** The split, after the plan. Existing ids are preserved wherever a name matched. */
  slots: SplitSlot[];
  phases: NutritionPhase[];
  pins: PlannedDay[];
  /** Exercises named by the plan that this device has never heard of. */
  createdExercises: Exercise[];
}

export interface PlanTarget {
  slots: readonly SplitSlot[];
  exercises: readonly Exercise[];
  nutritionPhases: readonly NutritionPhase[];
}

/** Names are matched case- and whitespace-insensitively; "bench press" is "Bench Press". */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Maps a plan's names onto this device's records.
 *
 * `newId` is a parameter rather than a module import so the resolution is a
 * total function over its inputs: the tests get deterministic ids, and nothing
 * here has to reach for a clock or a random source.
 *
 * Three matching rules, and each one exists to protect something:
 *
 *   a CARD matches an existing slot BY NAME, keeping its id -- which keeps
 *   every WorkoutSession that references it attached to it
 *
 *   a PHASE matches an existing phase BY START DATE, keeping its id -- phases
 *   have no inbound references, so this is only to avoid needless churn
 *
 *   an EXERCISE matches BY NAME, and is created when nothing matches -- a
 *   created one is an `accessory`, which is the conservative label: `cardio` is
 *   the only type the app branches on, and nothing should become cardio because
 *   a name arrived in a plan
 */
export function resolvePlan(
  plan: PlanPayload,
  target: PlanTarget,
  newId: () => string,
): PlanResolution {
  const slotByName = new Map(target.slots.map((s) => [key(s.name), s]));
  const exerciseByName = new Map(target.exercises.map((e) => [key(e.name), e]));
  const phaseByStart = new Map(target.nutritionPhases.map((p) => [p.startsOn, p]));

  const createdExercises: Exercise[] = [];
  const resolveExercise = (name: string): Exercise => {
    const existing = exerciseByName.get(key(name));
    if (existing) return existing;
    const created: Exercise = { id: newId(), name: name.trim(), type: "accessory" };
    // Registered immediately so a name repeated across two cards resolves to
    // one record rather than creating a duplicate on the second mention.
    exerciseByName.set(key(name), created);
    createdExercises.push(created);
    return created;
  };

  const slots: SplitSlot[] = plan.cards.map((card) => {
    const existing = slotByName.get(key(card.name));
    return {
      id: existing?.id ?? newId(),
      name: card.name,
      rotationOrder: card.rotationOrder,
      kind: card.kind,
      ...(card.weekday === undefined ? {} : { weekday: card.weekday }),
      plannedLifts: card.lifts.map((lift) => ({
        exerciseId: resolveExercise(lift.name).id,
        ...(lift.sets === undefined ? {} : { sets: lift.sets }),
        ...(lift.reps === undefined ? {} : { reps: lift.reps }),
        ...(lift.load === undefined ? {} : { load: lift.load }),
      })),
      // Where the client is in the split is theirs, not the plan's: a new
      // programme does not mean the last Upper day never happened.
      ...(existing?.lastLoggedAt !== undefined ? { lastLoggedAt: existing.lastLoggedAt } : {}),
    };
  });

  const phases: NutritionPhase[] = plan.phases.map((phase) => ({
    id: phaseByStart.get(phase.startsOn)?.id ?? newId(),
    startsOn: phase.startsOn,
    endsOn: phase.endsOn,
    name: phase.name,
    note: phase.note,
    calories: phase.calories,
    protein: phase.protein,
    carbs: phase.carbs,
    fat: phase.fat,
    steps: phase.steps,
  }));

  const slotByPlanName = new Map(slots.map((s) => [key(s.name), s]));
  const pins: PlannedDay[] = plan.pins
    .map((pin) => {
      const slot = slotByPlanName.get(key(pin.cardName));
      return slot ? { date: pin.date, splitSlotId: slot.id } : undefined;
    })
    // `parsePlanTab` already refuses a plan whose pin names an absent card, so
    // this cannot drop anything in practice. It is here so that a payload built
    // in code, which never passed through the parser, cannot produce a pin
    // pointing at nothing.
    .filter((p): p is PlannedDay => p !== undefined);

  return { slots, phases, pins, createdExercises };
}

/**
 * Whether this device should publish its own plan over what the tab holds.
 *
 * Both sides write this tab, which makes "the client's ordinary sync overwrites
 * the plan its coach just sent" a reachable bug -- and a bad one, because the
 * plan would vanish before the client ever saw the prompt to accept it.
 *
 * So a coach-issued plan the client has not yet absorbed is left alone. Once it
 * has been accepted, the client's own plan IS that plan, and publishing it
 * again is harmless and keeps the tab current with any edits made since.
 */
export function shouldPublishOwnPlan(
  tabPlan: PlanPayload | undefined,
  lastAcceptedAt: string | undefined,
): boolean {
  if (!tabPlan) return true; // Empty, or a layout this app cannot read.
  if (tabPlan.issuedBy !== "coach") return true;
  return !isNewerCoachPlan(tabPlan, lastAcceptedAt);
}

// --- What a plan would change --------------------------------------------

/**
 * One line of the review screen.
 *
 * Deliberately flat and pre-formatted rather than a structured delta. Every
 * consumer renders the same sentence -- what it is, and what is happening to it
 * -- and a structure rich enough to re-derive that sentence in three places
 * would be three chances for the three to disagree about what "changed" means.
 */
export interface PlanChange {
  area: "Nutrition" | "Training" | "Pinned days";
  /** What is changing: a phase and field, a card name, a date. */
  subject: string;
  kind: "added" | "removed" | "changed";
  /** "2400 → 2200", or a list of lifts. Absent when the subject says it all. */
  detail?: string;
}

const MACRO_LABELS: Array<[keyof PlanPhase, string]> = [
  ["calories", "Calories"],
  ["protein", "Protein"],
  ["carbs", "Carbs"],
  ["fat", "Fat"],
  ["steps", "Steps"],
];

function arrow(from: unknown, to: unknown): string {
  return `${from ?? "—"} → ${to ?? "—"}`;
}

/**
 * What accepting `next` would change, against `current`.
 *
 * An empty result means the two plans are the same, which is the signal the
 * Save button uses to stay hidden and the accept screen uses to say there is
 * nothing to review.
 *
 * Phases are matched by start date, cards by name -- the same identities the
 * format itself uses, so a renamed card reads as one removed and one added
 * rather than as a card that mysteriously changed its name. That is the honest
 * rendering: as far as history is concerned, that is exactly what it is.
 */
export function diffPlan(current: PlanPayload | undefined, next: PlanPayload): PlanChange[] {
  const changes: PlanChange[] = [];
  const before = current ?? { phases: [], cards: [], pins: [] };

  // --- Nutrition --------------------------------------------------------
  const phasesBefore = new Map(before.phases.map((p) => [p.startsOn, p]));
  const phasesAfter = new Map(next.phases.map((p) => [p.startsOn, p]));

  for (const [startsOn, phase] of phasesAfter) {
    const old = phasesBefore.get(startsOn);
    if (!old) {
      changes.push({
        area: "Nutrition",
        subject: `${phase.name}, from ${startsOn}`,
        kind: "added",
        detail: summarisePhase(phase),
      });
      continue;
    }
    if (old.name !== phase.name) {
      changes.push({
        area: "Nutrition",
        subject: `Phase from ${startsOn}`,
        kind: "changed",
        detail: arrow(old.name, phase.name),
      });
    }
    if (old.endsOn !== phase.endsOn) {
      changes.push({
        area: "Nutrition",
        subject: `${phase.name}, ends`,
        kind: "changed",
        // "ongoing" rather than a blank: a phase losing its end date is a real
        // change to what the plan says, and an arrow pointing at nothing reads
        // as a rendering fault.
        detail: arrow(old.endsOn ?? "ongoing", phase.endsOn ?? "ongoing"),
      });
    }
    if (old.note !== phase.note) {
      changes.push({
        area: "Nutrition",
        subject: `${phase.name} · note`,
        kind: "changed",
        detail: arrow(old.note, phase.note),
      });
    }
    for (const [field, label] of MACRO_LABELS) {
      if (old[field] !== phase[field]) {
        changes.push({
          area: "Nutrition",
          subject: `${phase.name} · ${label}`,
          kind: "changed",
          detail: arrow(old[field], phase[field]),
        });
      }
    }
  }
  for (const [startsOn, phase] of phasesBefore) {
    if (!phasesAfter.has(startsOn)) {
      changes.push({
        area: "Nutrition",
        subject: `${phase.name}, from ${startsOn}`,
        kind: "removed",
      });
    }
  }

  // --- Training ---------------------------------------------------------
  const cardKey = (name: string) => name.trim().toLowerCase();
  const cardsBefore = new Map(before.cards.map((c) => [cardKey(c.name), c]));
  const cardsAfter = new Map(next.cards.map((c) => [cardKey(c.name), c]));

  for (const [k, card] of cardsAfter) {
    const old = cardsBefore.get(k);
    if (!old) {
      changes.push({
        area: "Training",
        subject: card.name,
        kind: "added",
        detail: card.lifts.map(formatLift).join(", ") || "no lifts yet",
      });
      continue;
    }
    if (old.kind !== card.kind) {
      changes.push({
        area: "Training",
        subject: card.name,
        kind: "changed",
        detail: arrow(old.kind, card.kind),
      });
    }
    if (old.rotationOrder !== card.rotationOrder) {
      changes.push({
        area: "Training",
        subject: `${card.name} · position`,
        kind: "changed",
        detail: arrow(old.rotationOrder + 1, card.rotationOrder + 1),
      });
    }
    // Compared as a joined string, not as sets: the order lifts are listed in
    // is the order they are preloaded in, so reordering them is a real change.
    const oldLifts = old.lifts.map(formatLift).join(", ");
    const newLifts = card.lifts.map(formatLift).join(", ");
    if (oldLifts !== newLifts) {
      changes.push({
        area: "Training",
        subject: `${card.name} · lifts`,
        kind: "changed",
        detail: arrow(oldLifts || "none", newLifts || "none"),
      });
    }
  }
  for (const [k, card] of cardsBefore) {
    if (!cardsAfter.has(k)) {
      changes.push({ area: "Training", subject: card.name, kind: "removed" });
    }
  }

  // --- Pinned days ------------------------------------------------------
  const pinsBefore = new Map(before.pins.map((p) => [p.date, p]));
  const pinsAfter = new Map(next.pins.map((p) => [p.date, p]));
  for (const [date, pin] of pinsAfter) {
    const old = pinsBefore.get(date);
    if (!old) {
      changes.push({ area: "Pinned days", subject: date, kind: "added", detail: pin.cardName });
    } else if (cardKey(old.cardName) !== cardKey(pin.cardName)) {
      changes.push({
        area: "Pinned days",
        subject: date,
        kind: "changed",
        detail: arrow(old.cardName, pin.cardName),
      });
    }
  }
  for (const [date, pin] of pinsBefore) {
    if (!pinsAfter.has(date)) {
      changes.push({ area: "Pinned days", subject: date, kind: "removed", detail: pin.cardName });
    }
  }

  return changes;
}

/** A phase's targets on one line, for the "added" case where there is no before. */
function summarisePhase(phase: PlanPhase): string {
  const parts = MACRO_LABELS.filter(([field]) => phase[field] !== undefined).map(
    ([field, label]) => `${label} ${phase[field]}`,
  );
  return parts.length > 0 ? parts.join(", ") : "no targets";
}
