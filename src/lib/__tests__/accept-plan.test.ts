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
  phases: [{ startsOn: "2026-09-20", name: "Cut", calories: 2200, steps: 12000 }],
  cards: [
    {
      name: "Upper",
      rotationOrder: 0,
      kind: "workout",
      lifts: [{ name: "Bench Press" }, { name: "Face Pull" }],
    },
    { name: "Rest", rotationOrder: 1, kind: "rest", lifts: [] },
  ],
  pins: [{ date: "2026-09-22", cardName: "Upper" }],
  mode: "rotation",
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
    nutritionPhases: [{ id: "p_old", startsOn: "2026-01-01", name: "Maintain", calories: 3000 }],
    plannedDays: [{ date: "2026-09-19", splitSlotId: "s_legs" }],
    nextSlotId: "s_legs",
    restSince: undefined,
    lastAcceptedPlanAt: undefined,
    coachManaged: false,
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

  it("drops a card quietly, but its sessions keep its name", async () => {
    const legsDay = { id: "sess_legs", splitSlotId: "s_legs", startedAt: DAY - 86_400_000 };
    useStore.setState({ sessions: [...useStore.getState().sessions, legsDay] });
    useStore.getState().acceptCoachPlan(PLAN);

    const byId = new Map(useStore.getState().sessions.map((s) => [s.id, s]));
    expect(byId.get("sess_legs")).toMatchObject({ splitSlotId: "s_legs", slotName: "Legs" });
    // A session on a surviving card is left exactly as it was.
    expect(byId.get("sess_1")!.slotName).toBeUndefined();
    await flush();
    expect((await db.sessions.get("sess_legs"))?.slotName).toBe("Legs");
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
    expect(upper.plannedLifts?.map((l) => l.exerciseId)).toEqual([
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

describe("a coach-managed plan", () => {
  it("is what accepting a coach's plan makes it, and survives a reload", async () => {
    useStore.getState().acceptCoachPlan(PLAN);
    expect(useStore.getState().coachManaged).toBe(true);
    await flush();
    useStore.setState({ hydrated: false, coachManaged: false });
    await useStore.getState().hydrate();
    expect(useStore.getState().coachManaged).toBe(true);
  });

  it("refuses every plan edit, so a control that forgets to hide cannot reach it", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const s = useStore.getState();
    const before = JSON.stringify({
      slots: s.slots,
      phases: s.nutritionPhases,
      pins: s.plannedDays,
    });
    const upper = s.slots.find((sl) => sl.name === "Upper")!;
    const phase = s.nutritionPhases[0];

    expect(s.addSplitCard({ name: "Arms" })).toBeUndefined();
    s.updateSplitCard(upper.id, { name: "Push" });
    s.deleteSplitCard(upper.id);
    s.moveSplitCard(upper.id, 1);
    s.reorderSlots(upper.id, s.slots[1].id);
    s.setSlotLifts(upper.id, []);
    expect(s.addPhase({ startsOn: "2026-12-01", name: "Gain" })).toBeUndefined();
    s.updatePhase(phase.id, { calories: 9999 });
    expect(s.setPhaseDates(phase.id, { startsOn: "2026-11-01" })).toBe(false);
    s.deletePhase(phase.id);
    s.pinDay("2026-09-30", upper.id);
    s.unpinDay("2026-09-22");

    const after = useStore.getState();
    expect(
      JSON.stringify({
        slots: after.slots,
        phases: after.nutritionPhases,
        pins: after.plannedDays,
      }),
    ).toBe(before);
  });

  it("still lets the person train: logging never waits on a plan", () => {
    useStore.getState().acceptCoachPlan(PLAN);
    useStore.getState().upsertDailyLog("2026-09-15", { calories: 2100 });
    expect(useStore.getState().dailyLogFor("2026-09-15")?.calories).toBe(2100);
  });

  it("hands the plan back on unlink, persisted, with the plan itself untouched", async () => {
    useStore.getState().acceptCoachPlan(PLAN);
    const slots = useStore.getState().slots;
    useStore.getState().unlinkCoach();

    expect(useStore.getState().coachManaged).toBe(false);
    expect(useStore.getState().slots).toEqual(slots);
    expect(useStore.getState().addSplitCard({ name: "Arms" })).toBeDefined();
    await flush();
    useStore.setState({ hydrated: false });
    await useStore.getState().hydrate();
    expect(useStore.getState().coachManaged).toBe(false);
  });
});
