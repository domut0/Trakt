import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

/**
 * The rules that keep the nutrition timeline meaning one thing.
 *
 * There are only two, and they are the whole contract: a phase may not end
 * before it starts, and two phases may not both claim the same day. Everything
 * else about a phase can be typed in freely.
 *
 * The overlap rule has ONE exception, and it is the interesting case here: an
 * open-ended phase is not making a claim about the future. It means "still
 * running, until something says otherwise", so starting a new phase inside one
 * closes it rather than colliding with it. Two phases with deliberate ends that
 * disagree is a different thing entirely, and that is refused.
 */

async function seed() {
  await db.delete();
  await db.open();
  useStore.setState({ hydrated: true, nutritionPhases: [], coachManaged: false });
  const s = useStore.getState();
  const a = s.addPhase({ startsOn: "2026-09-13", endsOn: "2026-09-19", name: "Maintenance" })!;
  const b = s.addPhase({ startsOn: "2026-09-20", name: "Cut" })!;
  return { a, b };
}

const phase = (id: string) => useStore.getState().nutritionPhases.find((p) => p.id === id);

describe("setPhaseDates", () => {
  let ids: { a: { id: string }; b: { id: string } };
  beforeEach(async () => {
    ids = await seed();
  });

  it("moves a phase to free dates", () => {
    expect(useStore.getState().setPhaseDates(ids.b.id, { startsOn: "2026-09-21" })).toBe(true);
    expect(phase(ids.b.id)?.startsOn).toBe("2026-09-21");
  });

  it("gives an open phase an end", () => {
    expect(useStore.getState().setPhaseDates(ids.b.id, { endsOn: "2026-12-31" })).toBe(true);
    expect(phase(ids.b.id)?.endsOn).toBe("2026-12-31");
  });

  it("reopens a phase when the end is cleared", () => {
    // `null` and "leave it alone" are different requests, which is why the
    // argument is not just an optional string.
    expect(useStore.getState().setPhaseDates(ids.a.id, { endsOn: null })).toBe(false);
    // ...refused here only because reopening Maintenance would swallow the Cut.
    // On the last phase there is nothing in the way.
    useStore.getState().setPhaseDates(ids.b.id, { endsOn: "2026-12-31" });
    expect(useStore.getState().setPhaseDates(ids.b.id, { endsOn: null })).toBe(true);
    expect(phase(ids.b.id)?.endsOn).toBeUndefined();
  });

  it("refuses an overlap, and changes nothing", () => {
    expect(useStore.getState().setPhaseDates(ids.b.id, { startsOn: "2026-09-19" })).toBe(false);
    expect(phase(ids.b.id)?.startsOn).toBe("2026-09-20");
    expect(phase(ids.a.id)?.endsOn).toBe("2026-09-19");
  });

  it("allows ranges that touch end to start", () => {
    // The ordinary arrangement. A phase ending on the 19th and the next
    // starting on the 20th share no day, and refusing that would make a
    // continuous plan impossible to express.
    expect(useStore.getState().setPhaseDates(ids.a.id, { endsOn: "2026-09-19" })).toBe(true);
  });

  it("refuses an end before its own start", () => {
    expect(useStore.getState().setPhaseDates(ids.a.id, { endsOn: "2026-09-01" })).toBe(false);
    expect(phase(ids.a.id)?.endsOn).toBe("2026-09-19");
  });

  it("lets a phase keep the dates it already has", () => {
    expect(useStore.getState().setPhaseDates(ids.b.id, { startsOn: "2026-09-20" })).toBe(true);
  });

  it("writes the move through to the database", async () => {
    useStore.getState().setPhaseDates(ids.b.id, { startsOn: "2027-01-01" });
    await new Promise((r) => setTimeout(r, 20));
    expect((await db.nutritionPhases.get(ids.b.id))?.startsOn).toBe("2027-01-01");
  });
});

describe("addPhase", () => {
  beforeEach(async () => {
    await seed();
  });

  it("closes an open-ended phase rather than colliding with it", async () => {
    const s = useStore.getState();
    // The Cut is open-ended. Starting something after it is the ordinary way a
    // plan moves on, and it must not be refused.
    const next = s.addPhase({ startsOn: "2027-01-01", name: "Maintain" });
    expect(next).toBeDefined();
    const cut = useStore.getState().nutritionPhases.find((p) => p.name === "Cut");
    expect(cut?.endsOn).toBe("2026-12-31");

    await new Promise((r) => setTimeout(r, 20));
    expect((await db.nutritionPhases.get(cut!.id))?.endsOn).toBe("2026-12-31");
  });

  it("refuses a phase that lands inside a closed one", () => {
    // Maintenance runs the 13th to the 19th with a deliberate end. A phase
    // starting on the 15th is two rows disagreeing about the 15th, and only the
    // user knows which is wrong.
    expect(useStore.getState().addPhase({ startsOn: "2026-09-15", name: "Oops" })).toBeUndefined();
    expect(useStore.getState().nutritionPhases).toHaveLength(2);
  });

  it("refuses a phase whose range swallows an existing one", () => {
    expect(
      useStore.getState().addPhase({ startsOn: "2026-09-01", endsOn: "2026-10-01", name: "Big" }),
    ).toBeUndefined();
    expect(useStore.getState().nutritionPhases).toHaveLength(2);
  });

  it("accepts a phase that sits in a gap", () => {
    useStore
      .getState()
      .setPhaseDates(useStore.getState().nutritionPhases.find((p) => p.name === "Cut")!.id, {
        startsOn: "2026-10-01",
      });
    // The 20th of September to the 30th now belongs to nobody, which is a real
    // state and a legal place to put a phase.
    const created = useStore
      .getState()
      .addPhase({ startsOn: "2026-09-21", endsOn: "2026-09-30", name: "Deload" });
    expect(created).toBeDefined();
  });

  it("refuses an end before its own start", () => {
    expect(
      useStore
        .getState()
        .addPhase({ startsOn: "2027-03-01", endsOn: "2027-02-01", name: "Backwards" }),
    ).toBeUndefined();
  });
});
