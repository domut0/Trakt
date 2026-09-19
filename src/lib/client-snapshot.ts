import type { CellValue } from "./csv";
import { SHEET_TABS } from "./sync";
import { parsePlanTab, resolvePlan, type PlanPayload } from "./plan-tab";
import type {
  DailyLog,
  Exercise,
  ExerciseType,
  SplitSlot,
  WorkoutSession,
  WorkoutSet,
} from "./store";
import type { NutritionPhase, PlannedDay } from "./planning";

/**
 * Rebuilding a client's app state from their spreadsheet, for coach mode.
 *
 * ## Why this is a reconstruction rather than a read
 *
 * The sheet is not a serialisation of the store, it is a READABLE rendering of
 * it. `setColumns` denormalises an `exerciseId` into an exercise name and a
 * split slot id into a slot name, deliberately, because the sheet's whole
 * purpose is that a person can open it and understand it. Nothing in it carries
 * an `exercises` table or a `slots` table.
 *
 * So the ids have to be invented on the way back in. Every exercise and slot
 * here is synthesised from the distinct names appearing in the rows, with a
 * deterministic id derived from the name. Without that, every set in History
 * renders as "Unknown" and every chart is empty.
 *
 * ## These ids are display-only
 *
 * A synthesised id exists to join rows to each other inside one snapshot. It
 * matches nothing on the client's own device and must never be written
 * anywhere. That is safe by construction rather than by care: coach mode holds
 * the database read-only the entire time a snapshot is on screen (see
 * `setDbReadOnly`), so there is no path from here to a durable write.
 *
 * ## What is missing, and why that is fine
 *
 * The sheet has no block groups and no rest times. Charts and History read
 * neither. Where a field cannot be recovered it is left undefined rather than
 * guessed, so a screen that needs it renders an empty state rather than a
 * fabricated number.
 */

export interface ClientSnapshot {
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  nutritionPhases: NutritionPhase[];
  plannedDays: PlannedDay[];
  unit: "lbs" | "kg";
  /** The plan as it stands in the sheet, for the coach to edit. */
  plan?: PlanPayload;
}

// --- Cell readers ---------------------------------------------------------

function text(value: CellValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

function num(value: CellValue): number | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function bool(value: CellValue): boolean | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const s = raw.toLowerCase();
  if (s === "true" || s === "yes") return true;
  if (s === "false" || s === "no") return false;
  return undefined;
}

/**
 * A row reader keyed by header NAME.
 *
 * Positional reads would break the moment someone inserted a column, which is
 * an ordinary thing to do to a spreadsheet and something the sheet's own
 * documentation explicitly permits.
 */
function reader(rows: readonly CellValue[][] | undefined) {
  if (!rows || rows.length < 2) return undefined;
  const index = new Map<string, number>();
  (rows[0] ?? []).forEach((cell, i) => {
    const name = text(cell);
    if (name !== undefined) index.set(name, i);
  });
  return {
    rows: rows.slice(1),
    get: (row: readonly CellValue[], header: string): CellValue => {
      const i = index.get(header);
      return i === undefined ? undefined : row[i];
    },
  };
}

/**
 * Local "yyyy-MM-dd" plus "HH:mm" as a timestamp.
 *
 * Built with the local-time Date constructor rather than by parsing an ISO
 * string, so a sheet written in the client's timezone lands on the same
 * calendar day when the coach opens it somewhere else. Charts and the weekly
 * counts group by day, so an hour of drift would move a workout between days.
 */
function timestamp(date: string | undefined, time: string | undefined): number | undefined {
  if (date === undefined) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new Date(
    y,
    m - 1,
    d,
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
  ).getTime();
}

/** Stable, readable, and obviously not a real id if one ever escapes. */
function synthId(prefix: string, name: string): string {
  return prefix + ":" + name.trim().toLowerCase();
}

// --- The reconstruction ---------------------------------------------------

/**
 * A client's app state, as far as their sheet describes it.
 *
 * Total: every tab is optional and a missing or unreadable one yields an empty
 * collection rather than a failure. A coach opening a client who has synced
 * nothing yet should see an empty app, not an error -- and a partially readable
 * sheet is more useful than none, which is the opposite of the rule for
 * `parsePlanTab`, where a half-applied PLAN would leave someone training to
 * something nobody wrote.
 */
export function buildClientSnapshot(
  tabs: Record<string, CellValue[][]> | undefined,
): ClientSnapshot {
  const exercises = new Map<string, Exercise>();
  const slots = new Map<string, SplitSlot>();
  const sessions: WorkoutSession[] = [];
  const sets: WorkoutSet[] = [];
  const dailyLogs: DailyLog[] = [];

  let unit: "lbs" | "kg" = "lbs";

  const exerciseFor = (name: string, type: ExerciseType): Exercise => {
    const id = synthId("ex", name);
    const existing = exercises.get(id);
    if (existing) return existing;
    const made: Exercise = { id, name, type };
    exercises.set(id, made);
    return made;
  };

  const slotFor = (name: string): SplitSlot => {
    const id = synthId("sl", name);
    const existing = slots.get(id);
    if (existing) return existing;
    const made: SplitSlot = { id, name, rotationOrder: slots.size };
    slots.set(id, made);
    return made;
  };

  // --- sessions, first: sets join onto them by slot and day ---------------
  //
  // No column a set can see carries its session's id, so sets are matched to
  // sessions by day and slot -- which is how a person reading the sheet would
  // do it, and unambiguous unless the same slot was trained twice in one day.
  // Nested rather than a joined string key so that no separator has to be a
  // character neither a date nor a slot name can contain.
  const sessionByDay = new Map<string, Map<string, WorkoutSession>>();
  const rememberSession = (date: string, slotId: string, session: WorkoutSession): void => {
    const forDay = sessionByDay.get(date) ?? new Map<string, WorkoutSession>();
    forDay.set(slotId, session);
    sessionByDay.set(date, forDay);
  };

  const sessionRows = reader(tabs?.[SHEET_TABS.sessions]);
  if (sessionRows) {
    for (const row of sessionRows.rows) {
      const id = text(sessionRows.get(row, "ID"));
      const date = text(sessionRows.get(row, "Date"));
      if (id === undefined || date === undefined) continue;
      const startedAt = timestamp(date, text(sessionRows.get(row, "Started")));
      if (startedAt === undefined) continue;

      const slotName = text(sessionRows.get(row, "Split Slot"));
      const slot = slotName === undefined ? undefined : slotFor(slotName);
      const endedAt = timestamp(date, text(sessionRows.get(row, "Ended")));
      const note = text(sessionRows.get(row, "Note"));

      const session: WorkoutSession = {
        id,
        splitSlotId: slot?.id,
        startedAt,
        ...(endedAt !== undefined ? { endedAt } : {}),
        ...(note !== undefined ? { note } : {}),
      };
      sessions.push(session);
      if (slot) rememberSession(date, slot.id, session);
    }
  }

  // --- sets ---------------------------------------------------------------
  const setRows = reader(tabs?.[SHEET_TABS.sets]);
  if (setRows) {
    for (const row of setRows.rows) {
      const id = text(setRows.get(row, "ID"));
      const exerciseName = text(setRows.get(row, "Exercise"));
      const date = text(setRows.get(row, "Date"));
      const weight = num(setRows.get(row, "Weight"));
      const reps = num(setRows.get(row, "Reps"));
      // A set with no exercise, no load or no reps is not renderable, and there
      // is nothing to infer it from. Skipping the row beats inventing one.
      if (id === undefined || exerciseName === undefined || date === undefined) continue;
      if (weight === undefined || reps === undefined) continue;

      const rowUnit = text(setRows.get(row, "Unit"));
      if (rowUnit === "kg" || rowUnit === "lbs") unit = rowUnit;

      const typeText = text(setRows.get(row, "Exercise Type"));
      const type: ExerciseType =
        typeText === "main" || typeText === "accessory" || typeText === "cardio"
          ? typeText
          : "accessory";
      const exercise = exerciseFor(exerciseName, type);

      const slotName = text(setRows.get(row, "Split Slot"));
      const slot = slotName === undefined ? undefined : slotFor(slotName);
      // A set whose session is missing from the sheet still renders in History
      // and on charts; it simply belongs to no session.
      const session = slot ? sessionByDay.get(date)?.get(slot.id) : undefined;

      const rpe = num(setRows.get(row, "RPE"));
      const setupNote = text(setRows.get(row, "Setup Note"));

      sets.push({
        id,
        sessionId: session?.id ?? "",
        exerciseId: exercise.id,
        weight,
        reps,
        ...(rpe !== undefined ? { rpe } : {}),
        ...(setupNote !== undefined ? { setupNote } : {}),
        loggedAt: timestamp(date, text(setRows.get(row, "Time"))) ?? 0,
      });
    }
  }

  // --- cardio -------------------------------------------------------------
  const cardioRows = reader(tabs?.[SHEET_TABS.cardio]);
  if (cardioRows) {
    for (const row of cardioRows.rows) {
      const id = text(cardioRows.get(row, "ID"));
      const date = text(cardioRows.get(row, "Date"));
      if (id === undefined || date === undefined) continue;
      const startedAt = timestamp(date, text(cardioRows.get(row, "Time")));
      if (startedAt === undefined) continue;

      const name = text(cardioRows.get(row, "Exercise"));
      const exercise = name === undefined ? undefined : exerciseFor(name, "cardio");
      const durationMinutes = num(cardioRows.get(row, "Duration (min)"));
      const distance = num(cardioRows.get(row, "Distance"));
      const setupNote = text(cardioRows.get(row, "Setup Note"));
      const note = text(cardioRows.get(row, "Note"));

      sessions.push({
        id,
        kind: "cardio",
        startedAt,
        endedAt: startedAt + (durationMinutes ?? 0) * 60_000,
        ...(exercise ? { cardioExerciseId: exercise.id } : {}),
        ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        ...(distance !== undefined ? { distance } : {}),
        ...(setupNote !== undefined ? { setupNote } : {}),
        ...(note !== undefined ? { note } : {}),
      });
    }
  }

  // --- daily --------------------------------------------------------------
  const dailyRows = reader(tabs?.[SHEET_TABS.daily]);
  if (dailyRows) {
    const fields: Array<[keyof DailyLog, string]> = [
      ["calories", "Calories"],
      ["protein", "Protein (g)"],
      ["carbs", "Carbs (g)"],
      ["fat", "Fat (g)"],
      ["steps", "Steps"],
      ["bodyweight", "Bodyweight"],
    ];
    for (const row of dailyRows.rows) {
      const date = text(dailyRows.get(row, "Date"));
      if (date === undefined) continue;
      const rowUnit = text(dailyRows.get(row, "Unit"));
      if (rowUnit === "kg" || rowUnit === "lbs") unit = rowUnit;

      const log: DailyLog = { date };
      for (const [field, header] of fields) {
        const n = num(dailyRows.get(row, header));
        if (n !== undefined) (log[field] as number) = n;
      }
      const untracked = bool(dailyRows.get(row, "Untracked"));
      if (untracked !== undefined) log.isUntracked = untracked;
      dailyLogs.push(log);
    }
  }

  // --- plan ---------------------------------------------------------------
  //
  // Resolved against the synthesised records so the coach's Plan tab renders
  // against the same slots the rest of the snapshot uses: a card the client has
  // history on keeps the slot its sets hang off, rather than appearing twice
  // under two ids.
  const plan = parsePlanTab(tabs?.[SHEET_TABS.plan]);
  let nutritionPhases: NutritionPhase[] = [];
  let plannedDays: PlannedDay[] = [];
  if (plan) {
    let minted = 0;
    const resolved = resolvePlan(
      plan,
      {
        slots: [...slots.values()],
        exercises: [...exercises.values()],
        nutritionPhases: [],
      },
      // Deterministic, like every other id in this file: a snapshot built twice
      // from one sheet must come out identical, or React would see every row as
      // new on each pull.
      () => synthId("plan", String(minted++)),
    );
    for (const slot of resolved.slots) slots.set(slot.id, slot);
    for (const created of resolved.createdExercises) exercises.set(created.id, created);
    nutritionPhases = resolved.phases;
    plannedDays = resolved.pins;
  }

  return {
    exercises: [...exercises.values()],
    slots: [...slots.values()],
    sessions,
    sets,
    dailyLogs,
    nutritionPhases,
    plannedDays,
    unit,
    plan,
  };
}
