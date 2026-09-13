import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

/**
 * Moving a change-point, which the ribbon does by dragging.
 *
 * The guard against two phases starting on one day used to live in the editor
 * sheet, which could simply refuse to save. A drag has no Save button, so the
 * guard has to live in the action.
 */

async function seed() {
  await db.delete();
  await db.open();
  useStore.setState({ hydrated: true, nutritionPhases: [] });
  const s = useStore.getState();
  const a = s.addPhase({ startsOn: "2026-09-13", name: "Maintenance", kind: "targets" })!;
  const b = s.addPhase({ startsOn: "2026-09-20", name: "Cut", kind: "targets" })!;
  return { a, b };
}

const startOf = (id: string) =>
  useStore.getState().nutritionPhases.find((p) => p.id === id)?.startsOn;

describe("setPhaseStart", () => {
  let ids: { a: { id: string }; b: { id: string } };
  beforeEach(async () => {
    ids = await seed();
  });

  it("moves a phase to a free date", () => {
    expect(useStore.getState().setPhaseStart(ids.b.id, "2026-09-21")).toBe(true);
    expect(startOf(ids.b.id)).toBe("2026-09-21");
  });

  it("refuses a date another phase already occupies, and changes nothing", () => {
    expect(useStore.getState().setPhaseStart(ids.b.id, "2026-09-13")).toBe(false);
    expect(startOf(ids.b.id)).toBe("2026-09-20");
    expect(startOf(ids.a.id)).toBe("2026-09-13");
  });

  it("lets a phase keep the date it already has", () => {
    // Otherwise a drag that ended where it began would report the phase as
    // colliding with itself.
    expect(useStore.getState().setPhaseStart(ids.b.id, "2026-09-20")).toBe(true);
  });

  it("writes the move through to the database", async () => {
    useStore.getState().setPhaseStart(ids.b.id, "2027-01-01");
    await new Promise((r) => setTimeout(r, 20));
    expect((await db.nutritionPhases.get(ids.b.id))?.startsOn).toBe("2027-01-01");
  });
});
