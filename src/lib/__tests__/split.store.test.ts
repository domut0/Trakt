import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";
import { kindOf } from "../planning";

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
    // These are the rotation mechanics; week mode has no cursor to test.
    planningMode: "rotation",
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
  });
}

/** The user's own split: Upper, Lower, Repeat, Rest, Repeat. */
function buildUL() {
  const s = useStore.getState();
  const upper = s.addSplitCard({ name: "Upper" })!;
  const lower = s.addSplitCard({ name: "Lower" })!;
  const rep1 = s.addSplitCard({ kind: "repeat" })!;
  const rest = s.addSplitCard({ kind: "rest" })!;
  const rep2 = s.addSplitCard({ kind: "repeat" })!;
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
    useStore.getState().setSlotLifts(upper.id, []);
    useStore.setState({
      slots: useStore
        .getState()
        .slots.map((s) => (s.id === upper.id ? { ...s, plannedLifts: [{ exerciseId: "e1" }] } : s)),
    });
    useStore.getState().updateSplitCard(upper.id, { kind: "rest" });
    const card = useStore.getState().slots.find((s) => s.id === upper.id);
    expect(card?.kind).toBe("rest");
    expect(card?.plannedLifts).toBeUndefined();
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

  it("writes the advance to disk, so a relaunch does not undo it", async () => {
    // The bug this is for: endWorkout moved the cursor in memory but was the
    // only cursor mover that never persisted. A PWA relaunch read the old
    // settings record back, and the split sat on the same card forever --
    // right on Upper days, wrong on Lower days.
    const { upper, lower } = buildUL();
    const s = () => useStore.getState();
    s().setNextCard(upper.id);
    s().startWorkout("Upper");
    s().endWorkout();
    expect(s().nextCard()?.id).toBe(lower.id);

    await new Promise((resolve) => setTimeout(resolve, 40));
    // Or hydrate reads an empty exercises table as a first run and never looks
    // at the settings record (see the persistence test above).
    await db.exercises.put({ id: "e1", name: "Bench Press", type: "main" });
    useStore.setState({ hydrated: false });
    await s().hydrate();

    expect(s().nextCard()?.id).toBe(lower.id);
  });

  it("returns to the top after a rest is taken", () => {
    const { upper, rest } = buildUL();
    useStore.getState().setNextCard(rest.id);
    useStore.getState().takeRestDay(rest.id);
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });
});

describe("week mode", () => {
  /** Monday-to-Sunday indexes, matching Date.getDay(). */
  const MON = 1;
  const WED = 3;

  it("answers 'what is next' from the calendar, not from a cursor", () => {
    const { upper, lower } = buildUL();
    useStore.setState({ planningMode: "week" });
    const today = new Date().getDay();
    useStore.getState().setCardWeekday(upper.id, today);
    useStore.getState().setCardWeekday(lower.id, (today + 1) % 7);

    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });

  it("shows nothing on a day with nothing on it, rather than rolling one forward", () => {
    // A weekly plan means "Upper on Mondays". Rolling a missed day forward is
    // the rotation again, wearing a calendar's clothes.
    const { upper } = buildUL();
    useStore.setState({ planningMode: "week" });
    useStore.getState().setCardWeekday(upper.id, (new Date().getDay() + 2) % 7);

    expect(useStore.getState().nextCard()).toBeUndefined();
  });

  it("gives a day to one card only, so nothing can claim the same morning", () => {
    const { upper, lower } = buildUL();
    useStore.setState({ planningMode: "week" });
    useStore.getState().setCardWeekday(upper.id, MON);
    useStore.getState().setCardWeekday(lower.id, MON);

    const slots = useStore.getState().slots;
    expect(slots.find((s) => s.id === upper.id)?.weekday).toBeUndefined();
    expect(slots.find((s) => s.id === lower.id)?.weekday).toBe(MON);
  });

  it("keeps every card and its history when the mode changes", async () => {
    const { upper, lower } = buildUL();
    useStore.setState({
      planningMode: "rotation",
      sessions: [{ id: "sess_1", splitSlotId: upper.id, startedAt: 1 }],
    });

    useStore.getState().setPlanningMode("week");
    const week = useStore.getState().slots;
    // Repeats survive the trip. Nothing renders one in week mode - "start
    // again" is what a week already means - but dropping them would mean
    // rebuilding the cycle by hand after a look at the other screen.
    expect(week.map((s) => s.id)).toContain(upper.id);
    expect(week.find((s) => s.id === upper.id)?.weekday).toBe(MON);
    expect(week.filter((s) => kindOf(s) === "repeat")).toHaveLength(2);
    expect(week.filter((s) => kindOf(s) === "repeat").every((s) => s.weekday === undefined)).toBe(
      true,
    );
    expect(useStore.getState().sessions[0].splitSlotId).toBe(upper.id);

    useStore.getState().setCardWeekday(lower.id, WED);
    useStore.getState().setPlanningMode("rotation");
    const back = useStore.getState().slots;
    // Each repeat comes back behind the card it was behind, not at the index it
    // happened to hold: the week was free to reorder those cards underneath it.
    expect(back.map((s) => s.name)).toEqual(["Upper", "Lower", "Repeat", "Rest", "Repeat"]);
    expect(back.every((s) => s.weekday === undefined)).toBe(true);
    expect(useStore.getState().nextCard()?.id).toBe(upper.id);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await db.slots.get(upper.id))?.weekday).toBeUndefined();
  });

  it("refuses both while a coach manages the plan", () => {
    const { upper } = buildUL();
    useStore.setState({ planningMode: "week", coachManaged: true });
    useStore.getState().setCardWeekday(upper.id, MON);
    useStore.getState().setPlanningMode("rotation");

    expect(useStore.getState().slots.find((s) => s.id === upper.id)?.weekday).toBeUndefined();
    expect(useStore.getState().planningMode).toBe("week");
    useStore.setState({ coachManaged: false });
  });
});

describe("logging a workout you forgot", () => {
  /** Yesterday, as a day key. */
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("puts the session on the day it happened, not on the day it was typed", () => {
    const { upper } = buildUL();
    const id = useStore.getState().startWorkout(upper.name, yesterday());

    const session = useStore.getState().sessions.find((s) => s.id === id)!;
    // Midday: nobody remembers when they started, and every day-bucketing
    // surface reads startedAt.
    expect(new Date(session.startedAt).getHours()).toBe(12);
    expect(new Date(session.startedAt).getDate()).toBe(new Date().getDate() - 1);
  });

  it("dates its sets to that day, and claims no rest times it cannot know", () => {
    const { upper } = buildUL();
    useStore.setState({ exercises: [{ id: "e1", name: "Bench Press", type: "main" }] });
    useStore.getState().startWorkout(upper.name, yesterday());

    useStore.getState().logSet({ exerciseId: "e1", weight: 100, reps: 5 });
    useStore.getState().logSet({ exerciseId: "e1", weight: 100, reps: 5 });

    const sets = useStore.getState().sets;
    expect(sets).toHaveLength(2);
    for (const set of sets) {
      expect(new Date(set.loggedAt).getDate()).toBe(new Date().getDate() - 1);
      // A gap read off the clock would measure how long ago the workout was.
      expect(set.timeBetweenSetsSeconds).toBeUndefined();
    }
    // Still in order, which is what the row list and every chart sort on.
    expect(sets[0].loggedAt).toBeLessThan(sets[1].loggedAt);
  });

  it("moves the split on when the workout just logged is the newest one", () => {
    // The case this exists for: trained this morning, logged it tonight.
    const { upper, lower } = buildUL();
    useStore.getState().setNextCard(upper.id);
    useStore.getState().startWorkout(upper.name, yesterday());
    useStore.getState().endWorkout();

    expect(useStore.getState().nextCard()?.id).toBe(lower.id);
  });

  it("leaves the split alone when backfilling something older than the last workout", () => {
    // Backfilling last Tuesday must not throw away where you actually are.
    const { upper, lower } = buildUL();
    useStore.setState({
      sessions: [{ id: "sess_recent", splitSlotId: lower.id, startedAt: Date.now() }],
    });
    useStore.getState().setNextCard(upper.id);

    useStore.getState().startWorkout(upper.name, yesterday());
    useStore.getState().endWorkout();

    expect(useStore.getState().nextCard()?.id).toBe(upper.id);
  });

  it("ends a backdated workout when its last set was logged, not hours later", () => {
    const { upper } = buildUL();
    useStore.setState({ exercises: [{ id: "e1", name: "Bench Press", type: "main" }] });
    const id = useStore.getState().startWorkout(upper.name, yesterday());
    useStore.getState().logSet({ exerciseId: "e1", weight: 100, reps: 5 });
    useStore.getState().endWorkout();

    const session = useStore.getState().sessions.find((s) => s.id === id)!;
    const minutes = (session.endedAt! - session.startedAt) / 60_000;
    expect(minutes).toBeLessThan(5);
  });
});
