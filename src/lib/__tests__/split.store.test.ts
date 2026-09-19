import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

/**
 * The workout split as the store runs it: cards, order, and the cursor.
 *
 * The cursor is the part worth pinning hard. The rotation this replaced had
 * none - it re-derived "next" from whichever slot was logged most recently - so
 * every way it can now get out of step with the cards is a new failure mode
 * that did not exist before.
 */

async function reset() {
  await db.delete();
  await db.open();
  useStore.setState({
    hydrated: true,
    slots: [],
    sessions: [],
    sets: [],
    exercises: [],
    dailyLogs: [],
    nutritionPhases: [],
    plannedDays: [],
    nextSlotId: undefined,
    activeSessionId: undefined,
    currentExerciseId: undefined,
    currentBlock: undefined,
  });
}

/** The user's own split: Upper, Lower, Repeat, Rest, Repeat. */
function buildUL() {
  const s = useStore.getState();
  const upper = s.addSplitCard({ name: "Upper" });
  const lower = s.addSplitCard({ name: "Lower" });
  const rep1 = s.addSplitCard({ kind: "repeat" });
  const rest = s.addSplitCard({ kind: "rest" });
  const rep2 = s.addSplitCard({ kind: "repeat" });
  return { upper, lower, rep1, rest, rep2 };
}

beforeEach(reset);

describe("addSplitCard", () => {
  it("appends in cycle order", () => {
    const { upper, lower } = buildUL();
    expect(upper.rotationOrder).toBe(0);
    expect(lower.rotationOrder).toBe(1);
    expect(useStore.getState().slots).toHaveLength(5);
  });

  it("names a repeat for you, since it is a marker rather than a thing", () => {
    const { rep1 } = buildUL();
    expect(rep1.name).toBe("Repeat");
    expect(rep1.kind).toBe("repeat");
  });

  it("defaults a rest's name and leaves a workout's kind absent", () => {
    const { rest, upper } = buildUL();
    expect(rest.name).toBe("Rest");
    // Absent rather than "workout", so every slot written before the split
    // existed reads correctly with no migration.
    expect(upper.kind).toBeUndefined();
  });
});

describe("the cursor", () => {
  it("starts at the first day card", () => {
    const { upper } = buildUL();
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });

  it("never points at a repeat", () => {
    const { rep1 } = buildUL();
    useStore.getState().setNextCard(rep1.id);
    expect(useStore.getState().nextSlotId).toBeUndefined();
    expect(useStore.getState().nextCard()?.kind).toBeUndefined();
  });

  it("moves to a card you choose", () => {
    const { lower } = buildUL();
    useStore.getState().setNextCard(lower.id);
    expect(useStore.getState().nextCard()?.id).toBe(lower.id);
  });

  it("falls back to the top when it points at a deleted card", () => {
    const { upper, lower } = buildUL();
    useStore.setState({ nextSlotId: "gone" });
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
    expect(lower).toBeDefined();
  });
});

describe("taking a rest", () => {
  it("spends the card and lands back on the first workout", () => {
    // The user's stated flow: rest is never arrived at, only chosen, and the
    // day after one the split is back at the top.
    const { upper, rest } = buildUL();
    useStore.getState().setNextCard(rest.id);
    expect(useStore.getState().nextCard()?.id).toBe(rest.id);

    useStore.getState().takeRestDay(rest.id);
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });

  it("refuses a card that is not a rest", () => {
    const { upper, lower } = buildUL();
    useStore.getState().setNextCard(upper.id);
    useStore.getState().takeRestDay(lower.id);
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });
});

describe("moveSplitCard", () => {
  it("renumbers everything so order stays dense", () => {
    const { upper, lower } = buildUL();
    useStore.getState().moveSplitCard(lower.id, 0);
    const ordered = [...useStore.getState().slots].sort(
      (a, b) => a.rotationOrder - b.rotationOrder,
    );
    expect(ordered.map((s) => s.id).slice(0, 2)).toEqual([lower.id, upper.id]);
    expect(ordered.map((s) => s.rotationOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("clamps rather than throwing on an out-of-range index", () => {
    const { upper } = buildUL();
    useStore.getState().moveSplitCard(upper.id, 99);
    const ordered = [...useStore.getState().slots].sort(
      (a, b) => a.rotationOrder - b.rotationOrder,
    );
    expect(ordered[ordered.length - 1].id).toBe(upper.id);
  });
});

describe("deleteSplitCard", () => {
  it("moves the cursor off a card it is about to remove", () => {
    // Deleting the card the split is pointing at would otherwise leave the
    // cursor aimed at nothing, and the screen with no answer for "what next".
    const { upper, lower } = buildUL();
    useStore.getState().setNextCard(upper.id);
    useStore.getState().deleteSplitCard(upper.id);
    expect(useStore.getState().nextCard()?.id).toBe(lower.id);
  });

  it("closes the gap in cycle order", () => {
    const { lower } = buildUL();
    useStore.getState().deleteSplitCard(lower.id);
    const ordered = [...useStore.getState().slots].sort(
      (a, b) => a.rotationOrder - b.rotationOrder,
    );
    expect(ordered.map((s) => s.rotationOrder)).toEqual([0, 1, 2, 3]);
  });

  it("keeps the card's name on the sessions logged against it", async () => {
    // History and the sheet name a session by its card. Without the copy, a
    // deleted card turns every session it ever owned into "Untitled".
    const { upper, lower } = buildUL();
    useStore.setState({
      sessions: [
        { id: "x_up", splitSlotId: upper.id, startedAt: 1 },
        { id: "x_low", splitSlotId: lower.id, startedAt: 2 },
        { id: "x_cardio", kind: "cardio", startedAt: 3 },
      ],
    });
    useStore.getState().deleteSplitCard(upper.id);

    const byId = new Map(useStore.getState().sessions.map((s) => [s.id, s]));
    expect(byId.get("x_up")).toMatchObject({ splitSlotId: upper.id, slotName: "Upper" });
    expect(byId.get("x_low")!.slotName).toBeUndefined();
    expect(byId.get("x_cardio")!.slotName).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await db.sessions.get("x_up"))?.slotName).toBe("Upper");
  });

  it("survives deleting every card", () => {
    const cards = Object.values(buildUL());
    for (const c of cards) useStore.getState().deleteSplitCard(c.id);
    expect(useStore.getState().slots).toEqual([]);
    expect(useStore.getState().nextCard()).toBeUndefined();
  });
});

describe("updateSplitCard", () => {
  it("drops the lifts when a workout stops being one", () => {
    // Keeping them would resurrect a plan silently if the card were ever
    // switched back to a workout.
    const { upper } = buildUL();
    useStore.getState().setSlotExercises(upper.id, []);
    useStore.setState({
      slots: useStore
        .getState()
        .slots.map((s) => (s.id === upper.id ? { ...s, plannedExerciseIds: ["e1"] } : s)),
    });
    useStore.getState().updateSplitCard(upper.id, { kind: "rest" });
    const card = useStore.getState().slots.find((s) => s.id === upper.id);
    expect(card?.kind).toBe("rest");
    expect(card?.plannedExerciseIds).toBeUndefined();
  });

  it("forces a repeat's name, whatever was typed", () => {
    const { upper } = buildUL();
    useStore.getState().updateSplitCard(upper.id, { name: "Anything", kind: "repeat" });
    expect(useStore.getState().slots.find((s) => s.id === upper.id)?.name).toBe("Repeat");
  });
});

describe("persistence", () => {
  it("writes the cursor to the settings row and reads it back", async () => {
    const { lower } = buildUL();
    useStore.getState().setNextCard(lower.id);
    await new Promise((r) => setTimeout(r, 20));

    const settings = (await db.meta.get("settings")) as unknown as Record<string, unknown>;
    expect(settings.nextSlotId).toBe(lower.id);

    // A row in a real table, or hydrate treats this as a FIRST RUN, seeds the
    // exercise library and never reads the settings record at all.
    await db.exercises.put({ id: "e1", name: "Bench Press", type: "main" });
    useStore.setState({ hydrated: false, nextSlotId: undefined });
    await useStore.getState().hydrate();
    expect(useStore.getState().nextSlotId).toBe(lower.id);
  });
});

describe("ending a workout consumes its card", () => {
  it("walks Upper, Lower, Upper, Lower and never reaches rest", async () => {
    // The end-to-end claim, through the store rather than the pure function:
    // finishing a workout is what moves the split, and the repeat before Rest
    // is what keeps Rest out of the cycle.
    const { upper, lower, rest } = buildUL();
    const s = () => useStore.getState();

    const walked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const card = s().nextCard()!;
      walked.push(card.name);
      s().startWorkout(card.name);
      s().endWorkout();
    }

    expect(walked).toEqual(["Upper", "Lower", "Upper", "Lower"]);
    expect(walked).not.toContain("Rest");
    expect(upper.id).not.toBe(lower.id);
    expect(rest).toBeDefined();
  });

  it("returns to the top after a rest is taken", () => {
    const { upper, rest } = buildUL();
    useStore.getState().setNextCard(rest.id);
    useStore.getState().takeRestDay(rest.id);
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });
});
