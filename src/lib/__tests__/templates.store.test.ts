import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

/**
 * Templates: a card worth writing once.
 *
 * The property that matters is that a template carries NAMES. A coach writes
 * "Upper A" once and drops it into any client's plan, and a client's exercise
 * ids are their own — so applying one has to resolve names against whoever is
 * on screen, creating what that device has never heard of.
 */

async function reset() {
  await db.delete();
  await db.open();
  useStore.setState({
    hydrated: true,
    exercises: [
      { id: "e_bench", name: "Bench Press", type: "main" },
      { id: "e_row", name: "Row", type: "main" },
    ],
    slots: [
      {
        id: "s_upper",
        name: "Upper",
        rotationOrder: 0,
        plannedLifts: [
          { exerciseId: "e_bench", sets: 3, reps: "8-12", load: "RPE 8" },
          { exerciseId: "e_row" },
        ],
      },
      { id: "s_lower", name: "Lower", rotationOrder: 1 },
    ],
    sessions: [],
    sets: [],
    templates: [],
    coachManaged: false,
    planningMode: "week",
  });
}

beforeEach(reset);

describe("saving a template", () => {
  it("keeps the lifts as names, with their prescriptions", () => {
    const template = useStore.getState().saveTemplateFrom("s_upper")!;

    expect(template.name).toBe("Upper");
    expect(template.lifts).toEqual([
      { name: "Bench Press", sets: 3, reps: "8-12", load: "RPE 8" },
      { name: "Row" },
    ]);
    // No ids at all: they mean nothing on another device.
    expect(JSON.stringify(template)).not.toContain("e_bench");
  });

  it("survives a reload, because a template is written once and reused for years", async () => {
    useStore.getState().saveTemplateFrom("s_upper", "Upper A");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await db.exercises.put({ id: "e_bench", name: "Bench Press", type: "main" });

    useStore.setState({ hydrated: false, templates: [] });
    await useStore.getState().hydrate();

    expect(useStore.getState().templates.map((t) => t.name)).toEqual(["Upper A"]);
  });

  it("forgets one on request", async () => {
    const template = useStore.getState().saveTemplateFrom("s_upper")!;
    useStore.getState().deleteTemplate(template.id);
    expect(useStore.getState().templates).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await db.templates.get(template.id)).toBeUndefined();
  });
});

describe("applying a template", () => {
  it("writes its lifts onto a card, matching exercises this device already has", () => {
    const template = useStore.getState().saveTemplateFrom("s_upper")!;
    useStore.getState().applyTemplate(template.id, "s_lower");

    const lower = useStore.getState().slots.find((s) => s.id === "s_lower")!;
    expect(lower.plannedLifts).toEqual([
      { exerciseId: "e_bench", sets: 3, reps: "8-12", load: "RPE 8" },
      { exerciseId: "e_row" },
    ]);
    // Nothing invented: both names were already known.
    expect(useStore.getState().exercises).toHaveLength(2);
  });

  it("creates an exercise the device has never heard of, as an accessory", () => {
    // The coach-mode case: the store holds a CLIENT's exercises, rebuilt from
    // their sheet, so a template naming a lift they have never logged must not
    // land as a blank row.
    useStore.setState({ templates: [] });
    const template = useStore.getState().saveTemplateFrom("s_upper")!;
    useStore.setState({ exercises: [{ id: "c_bench", name: "bench press", type: "main" }] });

    useStore.getState().applyTemplate(template.id, "s_lower");

    const state = useStore.getState();
    const lower = state.slots.find((s) => s.id === "s_lower")!;
    const created = state.exercises.find((e) => e.name === "Row")!;
    expect(created.type).toBe("accessory");
    // Matched case-insensitively, so a client's "bench press" is not duplicated.
    expect(lower.plannedLifts?.[0].exerciseId).toBe("c_bench");
    expect(lower.plannedLifts?.[1].exerciseId).toBe(created.id);
  });

  it("refuses while a coach manages the plan", () => {
    const template = useStore.getState().saveTemplateFrom("s_upper")!;
    useStore.setState({ coachManaged: true });
    useStore.getState().applyTemplate(template.id, "s_lower");
    expect(useStore.getState().slots.find((s) => s.id === "s_lower")?.plannedLifts).toBeUndefined();
  });
});
