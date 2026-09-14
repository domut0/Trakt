import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";
import type { PlanPayload } from "../plan-tab";

/**
 * Accepting a coach's plan, against the real database.
 *
 * The thing worth proving is what the plan does NOT touch. A client accepting a
 * new programme keeps every set they have ever logged, and keeps those sets
 * attached to the cards they were logged against.
 */

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

const DAY = new Date(2026, 8, 12, 9, 0, 0).getTime();

const PLAN: PlanPayload = {
  phases: [{ startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2200, steps: 12000 }],
  cards: [
    {
      name: "Upper",
      rotationOrder: 0,
      kind: "workout",
      exerciseNames: ["Bench Press", "Face Pull"],
    },
    { name: "Rest", rotationOrder: 1, kind: "rest", exerciseNames: [] },
  ],
  pins: [{ date: "2026-09-22", cardName: "Upper" }],
  issuedBy: "coach",
  issuedAt: "2026-09-14T10:00:00.000Z",
};

beforeEach(async () => {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.nutritionPhases.clear(),
    db.plannedDays.clear(),
    db.meta.clear(),
  ]);
  useStore.setState({
    unit: "lbs",
    exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
    slots: [
      { id: "s_upper", name: "Upper", rotationOrder: 0, lastLoggedAt: DAY },
      { id: "s_legs", name: "Legs", rotationOrder: 1 },
    ],
    sessions: [{ id: "sess_1", splitSlotId: "s_upper", startedAt: DAY, endedAt: DAY + 3_600_000 }],
    sets: [
      {
        id: "set_1",
        sessionId: "sess_1",
        exerciseId: "e_bench",
        weight: 225,
        reps: 5,
        loggedAt: DAY,
      },
    ],
    dailyLogs: [],
    nutritionPhases: [
      { id: "p_old", startsOn: "2026-01-01", name: "Maintain", kind: "targets", calories: 3000 },
    ],
    plannedDays: [{ date: "2026-09-19", splitSlotId: "s_legs" }],
    nextSlotId: "s_legs",
    restSince: undefined,
    lastAcceptedPlanAt: undefined,
    hydrated: true,
  });
});

describe("acceptCoachPlan", () => {
  it("keeps every logged set attached to the card it was logged against", async () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const state = useStore.getState();

    expect(state.sets).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    const upper = state.slots.find((s) => s.name === "Upper")!;
    // The whole reason cards match by name rather than by id.
    expect(upper.id).toBe("s_upper");
    expect(state.sessions[0].splitSlotId).toBe("s_upper");
  });

  it("replaces the nutrition timeline with the coach's", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const phases = useStore.getState().nutritionPhases;
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({ startsOn: "2026-09-20", calories: 2200, steps: 12000 });
  });

  it("replaces the split, dropping a card the plan does not mention", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const names = useStore
      .getState()
      .slots.map((s) => s.name)
      .sort();
    expect(names).toEqual(["Rest", "Upper"]);
  });

  it("creates an exercise the client has never logged", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const state = useStore.getState();
    const facePull = state.exercises.find((e) => e.name === "Face Pull")!;
    expect(facePull).toBeDefined();
    const upper = state.slots.find((s) => s.name === "Upper")!;
    expect(upper.plannedExerciseIds).toEqual([
      state.exercises.find((e) => e.name === "Bench Press")!.id,
      facePull.id,
    ]);
  });

  it("repoints the pins at the resolved cards", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const pins = useStore.getState().plannedDays;
    expect(pins).toEqual([{ date: "2026-09-22", splitSlotId: "s_upper" }]);
  });

  it("keeps where the client was in their split when that card survives", () => {
    useStore.setState({ nextSlotId: "s_upper" });
    useStore.getState().acceptCoachPlan(PLAN);
    expect(useStore.getState().nextSlotId).toBe("s_upper");
  });

  it("sends the cursor back to the top when its card was dropped", () => {
    // nextSlotId was s_legs, which this plan does not carry. Leaving it there
    // would strand the rotation on a card that no longer exists.
    useStore.getState().acceptCoachPlan(PLAN);
    expect(useStore.getState().nextSlotId).toBeUndefined();
  });

  it("records which plan is in force, so it is never offered twice", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    expect(useStore.getState().lastAcceptedPlanAt).toBe("2026-09-14T10:00:00.000Z");
  });

  it("persists all of it, so a reload shows the accepted plan", async () => {
    useStore.getState().acceptCoachPlan(PLAN);
    await flush();

    expect(await db.nutritionPhases.count()).toBe(1);
    expect((await db.slots.toArray()).map((s) => s.name).sort()).toEqual(["Rest", "Upper"]);
    // The dropped card and its stale pin must be gone from disk too, or the
    // next hydrate would bring them back.
    expect(await db.slots.get("s_legs")).toBeUndefined();
    expect(await db.plannedDays.get("2026-09-19")).toBeUndefined();
    expect(await db.nutritionPhases.get("p_old")).toBeUndefined();
    expect((await db.meta.get("settings")) as { lastAcceptedPlanAt?: string }).toMatchObject({
      lastAcceptedPlanAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("survives a hydrate, which is the real test of the write", async () => {
    useStore.getState().acceptCoachPlan(PLAN);
    await flush();
    useStore.setState({ hydrated: false });
    await useStore.getState().hydrate();

    const state = useStore.getState();
    expect(state.nutritionPhases[0].calories).toBe(2200);
    expect(state.slots.map((s) => s.name).sort()).toEqual(["Rest", "Upper"]);
    expect(state.lastAcceptedPlanAt).toBe("2026-09-14T10:00:00.000Z");
    expect(state.exercises.some((e) => e.name === "Face Pull")).toBe(true);
  });

  it("accepts an empty plan as an empty plan rather than refusing it", () => {
    // A coach clearing someone's programme is a real instruction.
    useStore.getState().acceptCoachPlan({ ...PLAN, phases: [], cards: [], pins: [] });
    const state = useStore.getState();
    expect(state.slots).toEqual([]);
    expect(state.nutritionPhases).toEqual([]);
    expect(state.sets).toHaveLength(1);
  });
});
