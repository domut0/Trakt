import { create } from "zustand";
import {
  db,
  isDbEmpty,
  isIndexedDbAvailable,
  loadAll,
  replaceAllData,
  safeWrite,
  seedDb,
  setWriteErrorHandler,
  type SettingsMeta,
} from "./db";
import { seedExercises } from "./exercise-library";

export type ExerciseType = "main" | "accessory";

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  setupNote?: string;
}

export interface SplitSlot {
  id: string;
  name: string;
  rotationOrder: number;
  lastLoggedAt?: number;
}

export interface WorkoutSession {
  id: string;
  splitSlotId: string;
  startedAt: number;
  endedAt?: number;
}

export interface WorkoutSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  weight: number;
  reps: number;
  rpe?: number;
  isDropsetOrPartial?: boolean;
  /** Setup notes captured at log time (e.g. "seat 4, pins 12"). Stored per-set
   * so it's a snapshot: editing next week's note never rewrites this entry.
   * The most recent non-empty note for an exercise is surfaced as a grey
   * suggestion the next time it's logged (see `lastSetupNoteFor`). */
  setupNote?: string;
  timeBetweenSetsSeconds?: number;
  blockGroupId?: string;
  loggedAt: number;
}

/** The shape produced by Settings' "Export backup" action, and the shape
 * `importData` / `replaceAllData` expect back in. Kept flat (no meta
 * nesting) to match the exported JSON exactly. */
export interface BackupData {
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  unit: "lbs" | "kg";
}

type CurrentBlock = {
  blockGroupId: string;
  targetSets: number;
  loggedInBlock: number;
  weight: number;
  reps: number;
  rpe?: number;
};

interface State {
  unit: "lbs" | "kg";
  chartsEnabled: boolean;
  calendarEnabled: boolean;
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: CurrentBlock;
  /** True once the client-side IndexedDB load (or first-run seed) has completed. */
  hydrated: boolean;
  /** True when the most recent IndexedDB write failed. Ephemeral UI state only:
   * never persisted, never included in a backup. */
  writeFailed: boolean;

  /** Client-only. Loads persisted state from IndexedDB, seeding it on first-ever run. Idempotent. */
  hydrate: () => Promise<void>;
  startWorkout: (slotName: string) => string;
  endWorkout: () => void;
  setCurrentExercise: (exerciseId: string) => void;
  addExercise: (name: string, type: ExerciseType) => Exercise;
  logSet: (input: {
    exerciseId: string;
    weight: number;
    reps: number;
    rpe?: number;
    setupNote?: string;
    targetSets: number;
  }) => void;
  logNextInBlock: (overrides?: { reps?: number }) => void;
  deleteSet: (setId: string) => void;
  /** Delete an entire logged workout: the session and every set in it. Recomputes
   * the affected split slot's lastLoggedAt from the sessions that remain, and
   * clears the in-progress workout if the deleted session was the active one. */
  deleteSession: (sessionId: string) => void;
  updateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  setUnit: (u: "lbs" | "kg") => void;
  setChartsEnabled: (v: boolean) => void;
  setCalendarEnabled: (v: boolean) => void;
  reorderSlots: (fromId: string, toId: string) => void;
  /** Full backup restore. Assumes `data` has already been validated by
   * `parseBackup` — replaces IndexedDB first (single transaction; a failure
   * there rejects and leaves both the DB and the in-memory store untouched),
   * then mirrors the same data into the live store and clears any
   * in-progress workout, since a fresh backup has none. */
  importData: (data: BackupData) => Promise<void>;
  /** Wipe all logged data (slots, sessions, sets), reset settings to defaults,
   * and restore the exercise preset library — a clean slate for testing. The
   * preset library is re-seeded so the picker stays usable AND so the DB is not
   * "empty" (which would make hydrate re-insert the demo history on next load). */
  clearAllData: () => Promise<void>;
  predictedNextSlotName: () => string | undefined;
  suggestedNextExerciseFor: (
    sessionId: string,
  ) => { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined;
  prefillFor: (
    sessionId: string,
    exerciseId: string,
  ) => { weight?: number; reps?: number; rpe?: number };
  /** The setup note to suggest for an exercise: the most recently logged
   * non-empty per-set note, falling back to the exercise's base note. Persists
   * across workouts so last week's setup shows up as a grey hint this week. */
  lastSetupNoteFor: (exerciseId: string) => string | undefined;
  /** Clears the write-failure banner. Does not retry the write; the in-memory
   * state is already current, this only dismisses the notice. */
  dismissWriteError: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Seed data — a couple of realistic sessions so the UI has something to render.
// Used ONLY by hydrate() to populate a brand-new (empty) IndexedDB on first run.
// The store's own default state is empty arrays (see useStore below); these
// constants are no longer read directly as the default state.
const now = Date.now();
const day = 86400000;


const seedSlots: SplitSlot[] = [
  { id: "s_hb", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: now - 3 * day },
  { id: "s_sq", name: "Squat", rotationOrder: 1, lastLoggedAt: now - 2 * day },
  { id: "s_vb", name: "Volume Bench", rotationOrder: 2, lastLoggedAt: now - day },
  { id: "s_arms", name: "Arms", rotationOrder: 3, lastLoggedAt: now - 5 * day },
];

const seedSessions: WorkoutSession[] = [
  {
    id: "sess_1",
    splitSlotId: "s_hb",
    startedAt: now - 3 * day,
    endedAt: now - 3 * day + 3600_000,
  },
  {
    id: "sess_2",
    splitSlotId: "s_sq",
    startedAt: now - 2 * day,
    endedAt: now - 2 * day + 3900_000,
  },
  { id: "sess_3", splitSlotId: "s_vb", startedAt: now - day, endedAt: now - day + 3400_000 },
];

const b1 = uid(),
  b2 = uid(),
  b3 = uid(),
  b4 = uid(),
  b5 = uid();
const seedSets: WorkoutSet[] = [
  // Heavy Bench 3 days ago
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 225,
    reps: 3,
    rpe: 7,
    blockGroupId: b1,
    loggedAt: now - 3 * day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 6,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 240,
    loggedAt: now - 3 * day + 900_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 7,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 220,
    loggedAt: now - 3 * day + 1130_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 8,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 235,
    loggedAt: now - 3 * day + 1370_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 4,
    rpe: 9,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 250,
    loggedAt: now - 3 * day + 1625_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_flap",
    weight: 57.5,
    reps: 6,
    rpe: 10,
    blockGroupId: b3,
    timeBetweenSetsSeconds: 300,
    loggedAt: now - 3 * day + 2000_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_flap",
    weight: 57.5,
    reps: 6,
    rpe: 10,
    blockGroupId: b3,
    timeBetweenSetsSeconds: 280,
    loggedAt: now - 3 * day + 2290_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_push",
    weight: 60,
    reps: 12,
    rpe: 9,
    blockGroupId: b4,
    timeBetweenSetsSeconds: 200,
    loggedAt: now - 3 * day + 2600_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_push",
    weight: 60,
    reps: 10,
    rpe: 10,
    blockGroupId: b4,
    timeBetweenSetsSeconds: 210,
    loggedAt: now - 3 * day + 2820_000,
  },
  // Squat 2 days ago
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 275,
    reps: 3,
    rpe: 8,
    blockGroupId: uid(),
    loggedAt: now - 2 * day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 7,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 260,
    loggedAt: now - 2 * day + 900_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 8,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 245,
    loggedAt: now - 2 * day + 1160_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 9,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 255,
    loggedAt: now - 2 * day + 1415_000,
  },
  // Volume Bench yesterday
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_bench",
    weight: 175,
    reps: 6,
    rpe: 7,
    blockGroupId: uid(),
    loggedAt: now - day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_bench",
    weight: 175,
    reps: 6,
    rpe: 8,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 200,
    loggedAt: now - day + 800_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_row",
    weight: 90,
    reps: 10,
    rpe: 8,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 190,
    loggedAt: now - day + 1100_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_row",
    weight: 90,
    reps: 10,
    rpe: 9,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 200,
    loggedAt: now - day + 1300_000,
  },
];

// ---------------------------------------------------------------------------
// Pure logic, extracted so it can be unit-tested with plain arrays — no store,
// no IndexedDB, no React. The store actions below are thin wrappers around
// these that read current state via get() and delegate here. Behavior must
// stay identical to the original inline implementations.
// ---------------------------------------------------------------------------

/** Rotation round-robin: predicts the next Split Slot name after whichever slot was most recently logged. */
export function predictNextSlotName(slots: SplitSlot[]): string | undefined {
  const sorted = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
  if (sorted.length === 0) return undefined;
  const lastLogged = sorted
    .filter((s) => s.lastLoggedAt)
    .sort((a, b) => (b.lastLoggedAt ?? 0) - (a.lastLoggedAt ?? 0))[0];
  if (!lastLogged) return sorted[0].name;
  const idx = sorted.findIndex((s) => s.id === lastLogged.id);
  return sorted[(idx + 1) % sorted.length].name;
}

/** Case-insensitive, whitespace-trimmed Split Slot lookup by name. */
export function matchSlot(slots: SplitSlot[], name: string): SplitSlot | undefined {
  const key = name.trim().toLowerCase();
  return slots.find((s) => s.name.trim().toLowerCase() === key);
}

/**
 * "Next Exercise" suggestion: pulls from the last occurrence of the SAME
 * Split Slot, advancing one exercise at a time in the order they were logged
 * that day, skipping exercises already done in the current session.
 */
export function suggestNextExercise(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
): { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined {
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess) return undefined;
  const doneExerciseIds = new Set(
    sets.filter((s) => s.sessionId === sessionId).map((s) => s.exerciseId),
  );
  // Last session of this slot (excluding current)
  const lastSess = sessions
    .filter((s) => s.splitSlotId === sess.splitSlotId && s.id !== sessionId && s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  if (!lastSess) return undefined;
  const setsInLast = sets
    .filter((s) => s.sessionId === lastSess.id)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const order: string[] = [];
  for (const s of setsInLast) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);
  const next = order.find((id) => !doneExerciseIds.has(id));
  if (!next) return undefined;
  const firstSet = setsInLast.find((s) => s.exerciseId === next);
  return { exerciseId: next, weight: firstSet?.weight, reps: firstSet?.reps, rpe: firstSet?.rpe };
}

/**
 * Distinct-weight-block matching: the Nth distinct weight/rep block logged
 * for an exercise in today's session prefills from the Nth distinct
 * weight/rep block logged for that exercise the last time this same Split
 * Slot occurred.
 */
export function computePrefill(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
  exerciseId: string,
): { weight?: number; reps?: number; rpe?: number } {
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess) return {};
  const setsToday = sets.filter((s) => s.sessionId === sessionId && s.exerciseId === exerciseId);
  const distinctToday = new Set(setsToday.map((s) => `${s.weight}x${s.reps}`)).size;
  const lastSess = sessions
    .filter((s) => s.splitSlotId === sess.splitSlotId && s.id !== sessionId && s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  if (!lastSess) return {};
  const lastSets = sets
    .filter((s) => s.sessionId === lastSess.id && s.exerciseId === exerciseId)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const distinctBlocks: WorkoutSet[] = [];
  const seen = new Set<string>();
  for (const s of lastSets) {
    const k = `${s.weight}x${s.reps}`;
    if (!seen.has(k)) {
      seen.add(k);
      distinctBlocks.push(s);
    }
  }
  const target = distinctBlocks[distinctToday];
  if (!target) return {};
  return { weight: target.weight, reps: target.reps, rpe: target.rpe };
}

export type ParseBackupResult = { ok: true; data: BackupData } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExercise(v: unknown): v is Exercise {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.name !== "string") return false;
  if (v.type !== "main" && v.type !== "accessory") return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  return true;
}

function isSplitSlot(v: unknown): v is SplitSlot {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.name !== "string") return false;
  if (typeof v.rotationOrder !== "number") return false;
  if (v.lastLoggedAt !== undefined && typeof v.lastLoggedAt !== "number") return false;
  return true;
}

function isWorkoutSession(v: unknown): v is WorkoutSession {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.splitSlotId !== "string") return false;
  if (typeof v.startedAt !== "number") return false;
  if (v.endedAt !== undefined && typeof v.endedAt !== "number") return false;
  return true;
}

function isWorkoutSet(v: unknown): v is WorkoutSet {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.sessionId !== "string") return false;
  if (typeof v.exerciseId !== "string") return false;
  if (typeof v.weight !== "number") return false;
  if (typeof v.reps !== "number") return false;
  if (v.rpe !== undefined && typeof v.rpe !== "number") return false;
  if (v.isDropsetOrPartial !== undefined && typeof v.isDropsetOrPartial !== "boolean") return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  if (v.timeBetweenSetsSeconds !== undefined && typeof v.timeBetweenSetsSeconds !== "number")
    return false;
  if (v.blockGroupId !== undefined && typeof v.blockGroupId !== "string") return false;
  if (typeof v.loggedAt !== "number") return false;
  return true;
}

/**
 * Parses and fully validates a backup JSON string against the exact shape
 * `exportJson` in Settings produces. Pure — no IndexedDB, no store, no DOM —
 * so the import flow can validate a file completely before touching
 * persistence, and this can be unit-tested directly. Never throws; returns a
 * discriminated result instead.
 */
export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "That file does not contain a backup." };
  }
  const { exercises, slots, sessions, sets, unit } = parsed;
  if (!Array.isArray(exercises) || !exercises.every(isExercise)) {
    return { ok: false, error: "The backup's exercises list is missing or malformed." };
  }
  if (!Array.isArray(slots) || !slots.every(isSplitSlot)) {
    return { ok: false, error: "The backup's split slots list is missing or malformed." };
  }
  if (!Array.isArray(sessions) || !sessions.every(isWorkoutSession)) {
    return { ok: false, error: "The backup's sessions list is missing or malformed." };
  }
  if (!Array.isArray(sets) || !sets.every(isWorkoutSet)) {
    return { ok: false, error: "The backup's sets list is missing or malformed." };
  }
  if (unit !== "lbs" && unit !== "kg") {
    return { ok: false, error: "The backup's unit must be lbs or kg." };
  }
  return {
    ok: true,
    data: {
      exercises: exercises as Exercise[],
      slots: slots as SplitSlot[],
      sessions: sessions as WorkoutSession[],
      sets: sets as WorkoutSet[],
      unit,
    },
  };
}

// ---------------------------------------------------------------------------
// Write-through persistence helpers. Every mutating store action calls one of
// these right after updating Zustand state. All of them are safe no-ops (they
// log and swallow) if the DB write fails — the in-memory state already won.
// These are only ever invoked from store actions, which only ever run from
// client-side user interaction — never during SSR render.
// ---------------------------------------------------------------------------

function persistActiveMeta(meta: {
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: CurrentBlock;
}) {
  safeWrite(() =>
    db.meta.put({
      key: "activeSession",
      activeSessionId: meta.activeSessionId,
      currentExerciseId: meta.currentExerciseId,
      currentBlock: meta.currentBlock,
    }),
  );
}

function persistSettings(unit: "lbs" | "kg", chartsEnabled: boolean, calendarEnabled: boolean) {
  safeWrite(() => db.meta.put({ key: "settings", unit, chartsEnabled, calendarEnabled }));
}

export const useStore = create<State>((set, get) => ({
  unit: "lbs",
  chartsEnabled: true,
  calendarEnabled: true,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
  writeFailed: false,

  hydrate: async () => {
    if (get().hydrated) return; // idempotent — never double-seed/duplicate on repeat calls
    if (!isIndexedDbAvailable()) {
      // Should never happen (hydrate is only ever invoked from a client-side
      // effect), but never leave the app stuck un-hydrated.
      set({ hydrated: true });
      return;
    }
    try {
      const empty = await isDbEmpty();
      if (empty) {
        const settings: SettingsMeta = {
          key: "settings",
          unit: "lbs",
          chartsEnabled: true,
          calendarEnabled: true,
        };
        await seedDb({
          exercises: seedExercises,
          slots: seedSlots,
          sessions: seedSessions,
          sets: seedSets,
          settings,
        });
        set({
          exercises: seedExercises,
          slots: seedSlots,
          sessions: seedSessions,
          sets: seedSets,
          unit: settings.unit,
          chartsEnabled: true,
          calendarEnabled: true,
          activeSessionId: undefined,
          currentExerciseId: undefined,
          currentBlock: undefined,
          hydrated: true,
        });
        return;
      }
      const data = await loadAll();
      set({
        exercises: data.exercises,
        slots: data.slots,
        sessions: data.sessions,
        sets: data.sets,
        unit: data.settings.unit,
        chartsEnabled: data.settings.chartsEnabled ?? true,
        calendarEnabled: data.settings.calendarEnabled ?? true,
        activeSessionId: data.activeSession.activeSessionId,
        currentExerciseId: data.activeSession.currentExerciseId,
        currentBlock: data.activeSession.currentBlock,
        hydrated: true,
      });
    } catch (err) {
      console.error("[store] hydrate failed", err);
      set({ hydrated: true }); // don't leave the UI stuck; falls back to empty in-memory state
    }
  },

  predictedNextSlotName: () => predictNextSlotName(get().slots),

  startWorkout: (slotName) => {
    const trimmed = slotName.trim();
    let slot = matchSlot(get().slots, trimmed);
    if (!slot) {
      const maxOrder = Math.max(-1, ...get().slots.map((s) => s.rotationOrder));
      slot = { id: uid(), name: trimmed, rotationOrder: maxOrder + 1 };
      set({ slots: [...get().slots, slot] });
      safeWrite(() => db.slots.put(slot!));
    }
    const sessionId = uid();
    const session: WorkoutSession = { id: sessionId, splitSlotId: slot.id, startedAt: Date.now() };
    set({
      sessions: [...get().sessions, session],
      activeSessionId: sessionId,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    safeWrite(() => db.sessions.put(session));
    persistActiveMeta({
      activeSessionId: sessionId,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    return sessionId;
  },

  endWorkout: () => {
    const id = get().activeSessionId;
    if (!id) return;
    const sess = get().sessions.find((s) => s.id === id);
    const endedAt = Date.now();
    const updatedSessions = get().sessions.map((s) => (s.id === id ? { ...s, endedAt } : s));
    const updatedSlots = get().slots.map((sl) =>
      sess && sl.id === sess.splitSlotId ? { ...sl, lastLoggedAt: endedAt } : sl,
    );
    set({
      sessions: updatedSessions,
      slots: updatedSlots,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    const updatedSession = updatedSessions.find((s) => s.id === id);
    if (updatedSession) safeWrite(() => db.sessions.put(updatedSession));
    if (sess) {
      const updatedSlot = updatedSlots.find((sl) => sl.id === sess.splitSlotId);
      if (updatedSlot) safeWrite(() => db.slots.put(updatedSlot));
    }
    persistActiveMeta({
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  setCurrentExercise: (exerciseId) => {
    set({ currentExerciseId: exerciseId, currentBlock: undefined });
    persistActiveMeta({
      activeSessionId: get().activeSessionId,
      currentExerciseId: exerciseId,
      currentBlock: undefined,
    });
  },

  addExercise: (name, type) => {
    const ex: Exercise = { id: uid(), name: name.trim(), type };
    set({ exercises: [...get().exercises, ex] });
    safeWrite(() => db.exercises.put(ex));
    return ex;
  },

  logSet: ({ exerciseId, weight, reps, rpe, setupNote, targetSets }) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const blockGroupId = uid();
    const setsInSession = get().sets.filter((s) => s.sessionId === sessionId);
    const lastLogged = setsInSession.sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const note = setupNote?.trim();
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId,
      exerciseId,
      weight,
      reps,
      rpe,
      setupNote: note || undefined,
      timeBetweenSetsSeconds: tbs,
      blockGroupId,
      loggedAt: Date.now(),
    };
    const currentBlock: CurrentBlock | undefined =
      targetSets > 1
        ? { blockGroupId, targetSets, loggedInBlock: 1, weight, reps, rpe }
        : undefined;
    set({
      sets: [...get().sets, newSet],
      currentExerciseId: exerciseId,
      currentBlock,
    });
    safeWrite(() => db.sets.put(newSet));
    persistActiveMeta({ activeSessionId: sessionId, currentExerciseId: exerciseId, currentBlock });
  },

  logNextInBlock: (overrides) => {
    const { activeSessionId, currentBlock, sets } = get();
    if (!activeSessionId || !currentBlock) return;
    const lastLogged = [...sets]
      .filter((s) => s.sessionId === activeSessionId)
      .sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const exerciseId = lastLogged?.exerciseId ?? get().currentExerciseId!;
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId: activeSessionId,
      exerciseId,
      weight: currentBlock.weight,
      reps: overrides?.reps ?? currentBlock.reps,
      rpe: currentBlock.rpe,
      setupNote: lastLogged?.setupNote,
      timeBetweenSetsSeconds: tbs,
      blockGroupId: currentBlock.blockGroupId,
      loggedAt: Date.now(),
    };
    const nextCount = currentBlock.loggedInBlock + 1;
    const updatedBlock: CurrentBlock = { ...currentBlock, loggedInBlock: nextCount };
    set({
      sets: [...sets, newSet],
      currentBlock: updatedBlock,
    });
    safeWrite(() => db.sets.put(newSet));
    persistActiveMeta({
      activeSessionId,
      currentExerciseId: get().currentExerciseId,
      currentBlock: updatedBlock,
    });
  },

  deleteSet: (setId) => {
    set({ sets: get().sets.filter((s) => s.id !== setId) });
    safeWrite(() => db.sets.delete(setId));
  },

  deleteSession: (sessionId) => {
    const sess = get().sessions.find((s) => s.id === sessionId);
    const sessions = get().sessions.filter((s) => s.id !== sessionId);
    const sets = get().sets.filter((s) => s.sessionId !== sessionId);
    let slots = get().slots;
    if (sess) {
      const remainingForSlot = sessions.filter(
        (s) => s.splitSlotId === sess.splitSlotId && s.endedAt != null,
      );
      const newLast = remainingForSlot.length
        ? Math.max(...remainingForSlot.map((s) => s.endedAt!))
        : undefined;
      slots = get().slots.map((sl) =>
        sl.id === sess.splitSlotId ? { ...sl, lastLoggedAt: newLast } : sl,
      );
    }
    const clearingActive = get().activeSessionId === sessionId;
    set({
      sessions,
      sets,
      slots,
      ...(clearingActive
        ? { activeSessionId: undefined, currentExerciseId: undefined, currentBlock: undefined }
        : {}),
    });
    safeWrite(() => db.sessions.delete(sessionId));
    safeWrite(() => db.sets.where("sessionId").equals(sessionId).delete());
    if (sess) {
      const updatedSlot = slots.find((sl) => sl.id === sess.splitSlotId);
      if (updatedSlot) safeWrite(() => db.slots.put(updatedSlot));
    }
    if (clearingActive) {
      persistActiveMeta({
        activeSessionId: undefined,
        currentExerciseId: undefined,
        currentBlock: undefined,
      });
    }
  },

  updateSet: (setId, patch) => {
    set({ sets: get().sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) });
    const updated = get().sets.find((s) => s.id === setId);
    if (updated) safeWrite(() => db.sets.put(updated));
  },

  setUnit: (u) => {
    set({ unit: u });
    persistSettings(u, get().chartsEnabled, get().calendarEnabled);
  },

  setChartsEnabled: (v) => {
    set({ chartsEnabled: v });
    persistSettings(get().unit, v, get().calendarEnabled);
  },

  setCalendarEnabled: (v) => {
    set({ calendarEnabled: v });
    persistSettings(get().unit, get().chartsEnabled, v);
  },

  reorderSlots: (fromId, toId) => {
    const slots = [...get().slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const fromIdx = slots.findIndex((s) => s.id === fromId);
    const toIdx = slots.findIndex((s) => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = slots.splice(fromIdx, 1);
    slots.splice(toIdx, 0, moved);
    const reordered = slots.map((s, i) => ({ ...s, rotationOrder: i }));
    set({ slots: reordered });
    safeWrite(() => db.slots.bulkPut(reordered));
  },

  importData: async (data) => {
    // Write to IndexedDB first — replaceAllData is one Dexie transaction, so
    // a failure partway through rejects and rolls everything back. Only once
    // that succeeds do we swap the in-memory store, so a DB failure leaves
    // both existing IndexedDB data AND the live UI state untouched.
    await replaceAllData(data);
    set({
      exercises: data.exercises,
      slots: data.slots,
      sessions: data.sessions,
      sets: data.sets,
      unit: data.unit,
      chartsEnabled: true,
      calendarEnabled: true,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  clearAllData: async () => {
    // Reuse the atomic replace: wipe every table, then write back only the
    // exercise preset library with empty history and default settings. Keeping
    // the presets means the DB is not "empty", so hydrate() won't re-seed the
    // demo history on the next load — the clean slate persists.
    await replaceAllData({
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      unit: "lbs",
    });
    set({
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      unit: "lbs",
      chartsEnabled: true,
      calendarEnabled: true,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  suggestedNextExerciseFor: (sessionId) =>
    suggestNextExercise(get().sessions, get().sets, sessionId),

  prefillFor: (sessionId, exerciseId) =>
    computePrefill(get().sessions, get().sets, sessionId, exerciseId),

  lastSetupNoteFor: (exerciseId) => {
    const mostRecentWithNote = get()
      .sets.filter((s) => s.exerciseId === exerciseId && s.setupNote?.trim())
      .sort((a, b) => b.loggedAt - a.loggedAt)[0];
    return (
      mostRecentWithNote?.setupNote ?? get().exercises.find((e) => e.id === exerciseId)?.setupNote
    );
  },

  dismissWriteError: () => set({ writeFailed: false }),
}));

// Registered at module scope so any failed IndexedDB write (from db.ts's
// safeWrite) surfaces as store state. db.ts cannot import this module back
// (store.ts already imports db.ts — that would be circular), so it exposes
// this setter instead. SSR-safe: this only assigns a function reference and
// never touches IndexedDB itself.
setWriteErrorHandler(() => {
  useStore.setState({ writeFailed: true });
});

export function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  // Epley
  return Math.round(weight * (1 + reps / 30));
}
