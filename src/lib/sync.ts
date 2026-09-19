import {
  cardioColumns,
  cardioSessionsInOrder,
  dailyLogColumns,
  sessionColumns,
  setColumns,
  sortDailyLogsByDate,
  sortSetsByLoggedAt,
  strengthSessionsInOrder,
  toRows,
  type CellValue,
  type ColumnSpec,
} from "./csv";
import type { DailyLog, Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "./store";
import type { NutritionPhase, PlannedDay } from "./planning";
import { buildPlanTab, planFromStore } from "./plan-tab";

/**
 * Google Sheets sync: pure logic only.
 *
 * Everything here is a total function over plain data. The single `fetch` lives
 * in sync-client.ts, and the scheduling in components/SyncEngine.tsx, so the
 * interesting half of this feature is testable without a network stub.
 *
 * ## Why a three-way merge
 *
 * The app is the source of truth and IndexedDB never stops being authoritative,
 * but a few columns are editable in the sheet (see EDITABLE_* below). That makes
 * "both sides changed since we last agreed" a reachable state, and no record in
 * this codebase carries an `updatedAt`, a revision, or a tombstone to resolve it
 * with.
 *
 * Rather than add those to every entity and every one of the ~20 write sites,
 * the app keeps the exact values it last pushed as a merge BASE. A field that
 * differs between remote and base is a sheet edit; one that differs between
 * local and base is an app edit. The base is the common ancestor, which is
 * precisely what per-record timestamps would otherwise have to reconstruct.
 *
 * ## What this deliberately will not do
 *
 * Rows missing from the sheet are never treated as deletions. Sorting, filtering
 * and fat-fingering rows in a spreadsheet are all ordinary things to do, and a
 * training log is not re-derivable. Deletion stays an in-app action.
 */

/** Bumped when the tab layout changes in a way a reader would notice. */
export const SYNC_FORMAT_VERSION = 3;

export const SHEET_TABS = {
  sets: "sets",
  sessions: "sessions",
  daily: "daily",
  cardio: "cardio",
  /**
   * The training and nutrition plan. Unlike the other tabs this is not a log:
   * both sides write it, and it is how a coach's plan reaches a client. See
   * plan-tab.ts, which owns its format.
   */
  plan: "plan",
  /** Written by the Apps Script, not by the app. Leading underscore sorts it last. */
  meta: "_sync",
} as const;

/** Column A of the two-way tabs. Anchors a row to its record across re-sorts. */
export const ID_HEADER = "ID";

// --- Editable field descriptors ------------------------------------------
//
// Declared as data rather than hand-written per-field merge code so that the
// merge, the base capture and the remote parse cannot disagree about which
// fields are editable or how a blank cell should read.

/**
 * `requiredNumber` fields refuse to accept a blank or unparseable cell: there is
 * no such thing as a set with no weight, so a cleared cell is a mistake to be
 * ignored rather than an edit to be applied. Every `optional*` field treats a
 * blank cell as a genuine clear.
 */
type FieldKind = "requiredNumber" | "optionalNumber" | "optionalString" | "optionalBoolean";

interface FieldSpec {
  header: string;
  kind: FieldKind;
}

const EDITABLE_SET_FIELDS = {
  weight: { header: "Weight", kind: "requiredNumber" },
  reps: { header: "Reps", kind: "requiredNumber" },
  rpe: { header: "RPE", kind: "optionalNumber" },
  setupNote: { header: "Setup Note", kind: "optionalString" },
} as const satisfies Record<string, FieldSpec>;

const EDITABLE_SESSION_FIELDS = {
  note: { header: "Note", kind: "optionalString" },
} as const satisfies Record<string, FieldSpec>;

const EDITABLE_DAILY_FIELDS = {
  calories: { header: "Calories", kind: "optionalNumber" },
  protein: { header: "Protein (g)", kind: "optionalNumber" },
  carbs: { header: "Carbs (g)", kind: "optionalNumber" },
  fat: { header: "Fat (g)", kind: "optionalNumber" },
  steps: { header: "Steps", kind: "optionalNumber" },
  bodyweight: { header: "Bodyweight", kind: "optionalNumber" },
  isUntracked: { header: "Untracked", kind: "optionalBoolean" },
} as const satisfies Record<string, FieldSpec>;

type EditableSet = { -readonly [K in keyof typeof EDITABLE_SET_FIELDS]?: CellValue };
type EditableSession = { -readonly [K in keyof typeof EDITABLE_SESSION_FIELDS]?: CellValue };
type EditableDaily = { -readonly [K in keyof typeof EDITABLE_DAILY_FIELDS]?: CellValue };

// --- Base snapshot --------------------------------------------------------

/**
 * The values last successfully pushed, keyed by record id. Only the editable
 * fields are kept: this is a merge ancestor, not a backup, and storing the whole
 * dataset a second time would roughly double the app's IndexedDB footprint for
 * no gain.
 */
export interface SyncBase {
  /** Sheet revision this base was captured from. Guards against a lost push. */
  revision: number;
  sets: Record<string, EditableSet>;
  sessions: Record<string, EditableSession>;
  dailyLogs: Record<string, EditableDaily>;
}

/** The store fields that reach the sheet. Anything absent here cannot dirty a sync. */
const SYNC_SOURCE_KEYS = [
  "exercises",
  "slots",
  "sessions",
  "sets",
  "dailyLogs",
  "nutritionPhases",
  "plannedDays",
  "unit",
] as const;

/**
 * Whether a store update changed anything the sheet would show.
 *
 * Reference equality is exact here, not an approximation: every mutating action
 * replaces its array immutably, so an unchanged array is the same array. This is
 * the app's only dirty signal, because there is no chokepoint on the write path
 * -- 31 independent `safeWrite` call sites, no funnel. Anything that ever writes
 * to IndexedDB without going through the store will be invisible to sync.
 *
 * Ephemeral fields are excluded by omission: `activeSessionId`, `currentBlock`,
 * `hydrated` and `writeFailed` all change during a workout without changing
 * anything the sheet carries.
 */
export function syncSourceChanged(a: SyncSource, b: SyncSource): boolean {
  return SYNC_SOURCE_KEYS.some((key) => a[key] !== b[key]);
}

/** The slice of store state the sync reads. `useStore.getState()` satisfies it. */
export interface SyncSource {
  exercises: readonly Exercise[];
  slots: readonly SplitSlot[];
  sessions: readonly WorkoutSession[];
  sets: readonly WorkoutSet[];
  dailyLogs: readonly DailyLog[];
  /** Carried so the plan tab can be written; not part of any merge. */
  nutritionPhases: readonly NutritionPhase[];
  plannedDays: readonly PlannedDay[];
  unit: "lbs" | "kg";
}

function pick<T extends object>(
  record: T,
  fields: Record<string, FieldSpec>,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const key of Object.keys(fields)) {
    out[key] = normalise((record as Record<string, unknown>)[key] as CellValue);
  }
  return out;
}

/** Captures the merge ancestor from the state that was just pushed. */
export function buildBase(source: SyncSource, revision: number): SyncBase {
  const base: SyncBase = { revision, sets: {}, sessions: {}, dailyLogs: {} };
  for (const set of source.sets) {
    base.sets[set.id] = pick(set, EDITABLE_SET_FIELDS);
  }
  for (const session of source.sessions) {
    base.sessions[session.id] = pick(session, EDITABLE_SESSION_FIELDS);
  }
  for (const log of source.dailyLogs) {
    base.dailyLogs[log.date] = pick(log, EDITABLE_DAILY_FIELDS);
  }
  return base;
}

// --- Push: building the tabs ---------------------------------------------

function withIdColumn<T extends { id: string }>(columns: ColumnSpec<T>[]): ColumnSpec<T>[] {
  return [{ header: ID_HEADER, accessor: (row) => row.id }, ...columns];
}

/**
 * The full set of tabs the app owns, ready to POST.
 *
 * The `_sync` tab is absent on purpose: the Apps Script owns it, because the
 * revision it carries is assigned server-side and the app cannot know it until
 * the push comes back.
 */
export function buildSheetTabs(
  source: SyncSource,
  plan: { issuedAt: string } | undefined,
): Record<string, CellValue[][]> {
  const { exercises, slots, sessions, sets, dailyLogs, unit } = source;

  const tabs: Record<string, CellValue[][]> = {
    [SHEET_TABS.sets]: toRows(
      sortSetsByLoggedAt(sets),
      withIdColumn(setColumns(sessions, exercises, slots, unit)),
    ),
    [SHEET_TABS.sessions]: toRows(
      strengthSessionsInOrder(sessions),
      withIdColumn(sessionColumns(slots, sets)),
    ),
    // No id column: DailyLog's primary key IS its date, which is already column A.
    [SHEET_TABS.daily]: toRows(sortDailyLogsByDate(dailyLogs), dailyLogColumns(unit)),
    [SHEET_TABS.cardio]: toRows(
      cardioSessionsInOrder(sessions),
      withIdColumn(cardioColumns(exercises, unit)),
    ),
  };

  // Omitted entirely rather than written blank when the caller says to leave it:
  // the Apps Script only clears the tabs it is handed, so an absent key is what
  // preserves a coach's pending plan through the client's ordinary sync.
  if (plan) {
    tabs[SHEET_TABS.plan] = buildPlanTab(
      planFromStore(source, { by: "client", at: plan.issuedAt }),
    );
  }

  return tabs;
}

// --- Pull: parsing the tabs back -----------------------------------------

/**
 * Collapses the several ways a cell can be empty into one.
 *
 * Apps Script hands back `""` for a blank cell while the store holds
 * `undefined`, so without this every blank cell would read as an edit on the
 * first pull. `0` and `false` are values, not blanks, and must survive.
 */
function normalise(value: CellValue): CellValue {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}

function coerce(value: CellValue, kind: FieldKind): CellValue {
  const raw = normalise(value);

  if (kind === "optionalString") {
    return raw === undefined ? undefined : String(raw);
  }

  if (kind === "optionalBoolean") {
    if (raw === undefined) return undefined;
    if (typeof raw === "boolean") return raw;
    const text = String(raw).trim().toLowerCase();
    if (text === "true" || text === "yes") return true;
    if (text === "false" || text === "no") return false;
    return undefined;
  }

  // Both numeric kinds. A cell typed as text ("225 lbs") is not a number the
  // app can store, so it reads as absent rather than as NaN.
  if (raw === undefined) return undefined;
  const num = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Maps header text to column index.
 *
 * Looked up by NAME rather than by position because inserting a column is a
 * normal thing to do in a spreadsheet, and a positional read would silently
 * start merging the wrong values the moment someone did it.
 */
function indexHeaders(rows: readonly CellValue[][]): Map<string, number> {
  const headers = new Map<string, number>();
  const first = rows[0] ?? [];
  first.forEach((cell, i) => {
    const name = typeof cell === "string" ? cell.trim() : String(cell ?? "");
    if (name) headers.set(name, i);
  });
  return headers;
}

interface ParsedTable {
  /** Row values keyed by the row's identity (record id, or date for daily). */
  rows: Map<string, Record<string, CellValue>>;
  /** True when the tab was missing or its headers did not line up. */
  unusable: boolean;
}

function parseTable(
  rows: readonly CellValue[][] | undefined,
  keyHeader: string,
  fields: Record<string, FieldSpec>,
): ParsedTable {
  const empty: ParsedTable = { rows: new Map(), unusable: true };
  if (!rows || rows.length === 0) return empty;

  const headers = indexHeaders(rows);
  const keyIndex = headers.get(keyHeader);
  if (keyIndex === undefined) return empty;

  // A tab missing every editable column is a layout the app does not recognise.
  // Merging from it would apply "cleared" to fields the user never touched.
  const present = Object.values(fields).filter((f) => headers.has(f.header));
  if (present.length === 0) return empty;

  const parsed = new Map<string, Record<string, CellValue>>();
  for (const row of rows.slice(1)) {
    const key = normalise(row[keyIndex]);
    if (key === undefined) continue;
    const id = String(key);

    // Duplicate keys mean the sheet no longer describes a set of records --
    // dragging the fill handle down a column is the usual cause. Taking the
    // last row would silently pick a winner, so the whole tab is refused and
    // the user is told, which leaves their typing intact to sort out.
    if (parsed.has(id)) return empty;

    const values: Record<string, CellValue> = {};
    for (const [name, spec] of Object.entries(fields)) {
      const index = headers.get(spec.header);
      // A column the user deleted is "no opinion", not "cleared". Leaving the
      // field out entirely makes the merge treat it as unchanged.
      if (index === undefined) continue;
      values[name] = coerce(row[index], spec.kind);
    }
    parsed.set(id, values);
  }

  return { rows: parsed, unusable: false };
}

// --- Merge ----------------------------------------------------------------

export interface Collision {
  tab: string;
  key: string;
  field: string;
  sheetValue: CellValue;
  appValue: CellValue;
}

export interface MergeReport {
  /** Field-level edits taken from the sheet. */
  applied: number;
  collisions: Collision[];
  /** Sheet rows with no matching record. Ignored for sets and sessions. */
  unknownRows: number;
  /** Records in the base that the sheet no longer has. Never deleted. */
  missingRows: number;
  /** Tabs whose layout could not be read, so were skipped whole. */
  skippedTabs: string[];
  /** True when there was no base, so nothing could be merged. */
  firstSync: boolean;
}

export interface MergeResult {
  setPatches: Array<{ id: string; patch: Partial<WorkoutSet> }>;
  sessionPatches: Array<{ id: string; patch: Partial<WorkoutSession> }>;
  dailyPatches: Array<{ date: string; patch: Partial<DailyLog> }>;
  report: MergeReport;
}

function emptyReport(firstSync: boolean): MergeReport {
  return {
    applied: 0,
    collisions: [],
    unknownRows: 0,
    missingRows: 0,
    skippedTabs: [],
    firstSync,
  };
}

/**
 * Resolves one record's editable fields.
 *
 * Returns only the fields the sheet should win, and records a collision for any
 * field both sides moved. The app wins a collision: the phone is where logging
 * happens, and losing a set you just did to a stale spreadsheet cell is the one
 * outcome worth ruling out entirely.
 */
function mergeRecord(
  tab: string,
  key: string,
  fields: Record<string, FieldSpec>,
  base: Record<string, CellValue>,
  local: Record<string, CellValue>,
  remote: Record<string, CellValue>,
  collisions: Collision[],
): Record<string, CellValue> {
  const patch: Record<string, CellValue> = {};

  for (const name of Object.keys(fields)) {
    if (!(name in remote)) continue;

    const baseValue = base[name];
    const localValue = local[name];
    const remoteValue = remote[name];

    if (remoteValue === baseValue) continue;

    if (localValue !== baseValue) {
      // Both moved. Agreeing on the same new value is not a conflict.
      if (localValue !== remoteValue) {
        collisions.push({ tab, key, field: name, sheetValue: remoteValue, appValue: localValue });
      }
      continue;
    }

    // A required field cannot be cleared from the sheet: dropping the weight
    // column's value would otherwise write NaN over a real set.
    if (remoteValue === undefined && fields[name].kind === "requiredNumber") continue;

    patch[name] = remoteValue;
  }

  return patch;
}

/**
 * Computes what the sheet should change in the app.
 *
 * Applies nothing itself. The caller feeds the patches through the existing
 * store actions (`updateSet`, `updateSession`, `upsertDailyLog`) so the write
 * path, and its IndexedDB write-through, stay the single ones in the app.
 */
export function mergeFromSheet(
  base: SyncBase | undefined,
  local: SyncSource,
  remoteTabs: Record<string, CellValue[][]> | undefined,
): MergeResult {
  const result: MergeResult = {
    setPatches: [],
    sessionPatches: [],
    dailyPatches: [],
    report: emptyReport(base === undefined),
  };

  // Without an ancestor there is no way to tell a sheet edit from a sheet that
  // is simply stale, so the first sync publishes and merges nothing.
  if (!base || !remoteTabs) return result;

  const report = result.report;

  const setsTable = parseTable(remoteTabs[SHEET_TABS.sets], ID_HEADER, EDITABLE_SET_FIELDS);
  const sessionsTable = parseTable(
    remoteTabs[SHEET_TABS.sessions],
    ID_HEADER,
    EDITABLE_SESSION_FIELDS,
  );
  const dailyTable = parseTable(remoteTabs[SHEET_TABS.daily], "Date", EDITABLE_DAILY_FIELDS);

  if (setsTable.unusable) report.skippedTabs.push(SHEET_TABS.sets);
  if (sessionsTable.unusable) report.skippedTabs.push(SHEET_TABS.sessions);
  if (dailyTable.unusable) report.skippedTabs.push(SHEET_TABS.daily);

  const localSets = new Map(local.sets.map((s) => [s.id, s]));
  const localSessions = new Map(local.sessions.map((s) => [s.id, s]));
  const localDaily = new Map(local.dailyLogs.map((l) => [l.date, l]));

  const countMissing = (baseKeys: Record<string, unknown>, table: ParsedTable): void => {
    if (table.unusable) return;
    for (const key of Object.keys(baseKeys)) {
      if (!table.rows.has(key)) report.missingRows += 1;
    }
  };

  for (const [id, remote] of setsTable.rows) {
    const baseRow = base.sets[id];
    const localRow = localSets.get(id);
    // Rows cannot be created from the sheet: a set with no id is one the app
    // has never seen, and inventing history from a spreadsheet row is not a
    // thing the user asked for.
    if (!baseRow || !localRow) {
      report.unknownRows += 1;
      continue;
    }
    const patch = mergeRecord(
      SHEET_TABS.sets,
      id,
      EDITABLE_SET_FIELDS,
      baseRow,
      pick(localRow, EDITABLE_SET_FIELDS),
      remote,
      report.collisions,
    );
    if (Object.keys(patch).length > 0) {
      report.applied += Object.keys(patch).length;
      result.setPatches.push({ id, patch: patch as Partial<WorkoutSet> });
    }
  }
  countMissing(base.sets, setsTable);

  for (const [id, remote] of sessionsTable.rows) {
    const baseRow = base.sessions[id];
    const localRow = localSessions.get(id);
    if (!baseRow || !localRow) {
      report.unknownRows += 1;
      continue;
    }
    const patch = mergeRecord(
      SHEET_TABS.sessions,
      id,
      EDITABLE_SESSION_FIELDS,
      baseRow,
      pick(localRow, EDITABLE_SESSION_FIELDS),
      remote,
      report.collisions,
    );
    if (Object.keys(patch).length > 0) {
      report.applied += Object.keys(patch).length;
      result.sessionPatches.push({ id, patch: patch as Partial<WorkoutSession> });
    }
  }
  countMissing(base.sessions, sessionsTable);

  for (const [date, remote] of dailyTable.rows) {
    const baseRow = base.dailyLogs[date];
    const localRow = localDaily.get(date);

    // Unlike sets, a daily row CAN be created from the sheet: its key is the
    // calendar date, so a row for a day never logged is unambiguous, and
    // back-filling a week of nutrition from a keyboard is the main reason this
    // tab is editable at all.
    if (!baseRow) {
      if (localRow) continue; // Created on the phone since the last push; app wins.
      const patch: Record<string, CellValue> = {};
      for (const [name, value] of Object.entries(remote)) {
        if (value !== undefined) patch[name] = value;
      }
      if (Object.keys(patch).length > 0) {
        report.applied += Object.keys(patch).length;
        result.dailyPatches.push({ date, patch: patch as Partial<DailyLog> });
      }
      continue;
    }

    const patch = mergeRecord(
      SHEET_TABS.daily,
      date,
      EDITABLE_DAILY_FIELDS,
      baseRow,
      localRow ? pick(localRow, EDITABLE_DAILY_FIELDS) : {},
      remote,
      report.collisions,
    );
    if (Object.keys(patch).length > 0) {
      report.applied += Object.keys(patch).length;
      result.dailyPatches.push({ date, patch: patch as Partial<DailyLog> });
    }
  }
  countMissing(base.dailyLogs, dailyTable);

  return result;
}

/** True when the sheet changed nothing the app needs to know about. */
export function isNoopMerge(result: MergeResult): boolean {
  return (
    result.setPatches.length === 0 &&
    result.sessionPatches.length === 0 &&
    result.dailyPatches.length === 0
  );
}
