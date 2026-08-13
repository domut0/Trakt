import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// fake-indexeddb/auto (loaded globally in src/test/setup.ts) gives us a real
// IndexedDB implementation backed by memory, so these exercise Dexie's actual
// read/write paths rather than a mock.

const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  habits: [],
  habitEntries: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
};

async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.meta.clear(),
  ]);
}

/** Store write-through is fire-and-forget; give pending IndexedDB requests a tick to land. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

describe("Dexie persistence (hydrate + write-through)", () => {
  it("seeds an empty DB on first hydrate", async () => {
    await useStore.getState().hydrate();
    const state = useStore.getState();

    expect(state.hydrated).toBe(true);
    // Full seed library (see PROGRESS.md — 117 exercises after Issue #5).
    expect(state.exercises.length).toBeGreaterThan(100);
    expect(state.slots.length).toBe(4);
    expect(state.sessions.length).toBe(3);
    expect(state.sets.length).toBeGreaterThan(0);
    expect(state.unit).toBe("lbs");

    // The seed actually landed in IndexedDB, not just in memory.
    expect(await db.exercises.count()).toBe(state.exercises.length);
  });

  it("does not re-seed or duplicate data on a second hydrate against an already-populated DB", async () => {
    await useStore.getState().hydrate();
    const firstCount = useStore.getState().exercises.length;

    // Simulate a fresh app load: fresh in-memory state, same (now-populated) DB.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const secondCount = useStore.getState().exercises.length;

    expect(secondCount).toBe(firstCount);
    expect(await db.exercises.count()).toBe(firstCount);
  });

  it("is a no-op when hydrate is called twice on the same already-hydrated store", async () => {
    await useStore.getState().hydrate();
    const first = useStore.getState().exercises;

    await useStore.getState().hydrate();
    const second = useStore.getState().exercises;

    expect(second).toBe(first); // same reference — the second call returned immediately
  });

  it("persists a logged set, a setting change, and the active-session pointer across a simulated reload", async () => {
    await useStore.getState().hydrate();
    const exercise = useStore.getState().exercises[0];

    const sessionId = useStore.getState().startWorkout("Reload Test Slot");
    useStore.getState().logSet({ exerciseId: exercise.id, weight: 135, reps: 5, targetSets: 1 });
    useStore.getState().setUnit("kg");
    useStore.getState().setChartsEnabled(false);
    await flush();

    // Simulate closing and reopening the app: fresh in-memory store, same DB.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();

    expect(reloaded.unit).toBe("kg");
    expect(reloaded.chartsEnabled).toBe(false);
    expect(reloaded.activeSessionId).toBe(sessionId);

    const persistedSets = reloaded.sets.filter((s) => s.sessionId === sessionId);
    expect(persistedSets).toHaveLength(1);
    expect(persistedSets[0]).toMatchObject({ exerciseId: exercise.id, weight: 135, reps: 5 });
  });

  it("persists deleteSet and addExercise across a simulated reload", async () => {
    await useStore.getState().hydrate();
    const exercise = useStore.getState().exercises[0];
    const sessionId = useStore.getState().startWorkout("Delete Test Slot");
    useStore.getState().logSet({ exerciseId: exercise.id, weight: 100, reps: 10, targetSets: 1 });
    await flush();
    const loggedSet = useStore.getState().sets.find((s) => s.sessionId === sessionId)!;

    useStore.getState().deleteSet(loggedSet.id);
    const newEx = useStore.getState().addExercise("Reload Custom Exercise", "accessory");
    await flush();

    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();

    expect(reloaded.sets.some((s) => s.id === loggedSet.id)).toBe(false);
    expect(
      reloaded.exercises.some((e) => e.id === newEx.id && e.name === "Reload Custom Exercise"),
    ).toBe(true);
  });
});
