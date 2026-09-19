import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

/**
 * The rest day, and the one card the clock can spend.
 *
 * Every other card is consumed by doing something: a workout ends, and the
 * split moves on. A rest has nothing to finish, so it is spent at the first
 * midnight after it was taken - which makes this the only place in the app
 * where the passage of time changes state on its own, and therefore the place
 * most worth pinning hard.
 *
 * The clock is faked rather than the dates computed, because "later than the
 * day it was taken" is exactly the comparison under test.
 */

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

async function buildUL() {
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
    restSince: undefined,
    activeSessionId: undefined,
  });
  const s = useStore.getState();
  return {
    upper: s.addSplitCard({ name: "Upper" })!,
    lower: s.addSplitCard({ name: "Lower" })!,
    rep1: s.addSplitCard({ kind: "repeat" })!,
    rest: s.addSplitCard({ kind: "rest" })!,
    rep2: s.addSplitCard({ kind: "repeat" })!,
  };
}

const next = () => useStore.getState().nextCard();

beforeEach(() => {
  // Date ONLY. Faking the timer queue as well stalls Dexie and
  // fake-indexeddb, both of which schedule their own work - every test here
  // then hangs on db.open(). The clock is the only thing under test.
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-09-13T09:00:00");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("taking a rest", () => {
  it("starts the clock on the day it is chosen", async () => {
    const { rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);
    expect(next()?.id).toBe(rest.id);
    expect(useStore.getState().restSince).toBe("2026-09-13");
  });

  it("stays put for the rest of the day it was taken", async () => {
    const { rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);

    at("2026-09-13T23:59:00");
    useStore.getState().settleRestDay();
    expect(next()?.id).toBe(rest.id);
  });

  it("is spent at the first midnight, landing back at the top", async () => {
    const { upper, rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);

    at("2026-09-14T00:00:30");
    useStore.getState().settleRestDay();
    expect(next()?.id).toBe(upper.id);
    expect(useStore.getState().restSince).toBeUndefined();
  });

  it("spends exactly one rest however long the app was closed", async () => {
    // A week away is still one day off, not seven advances through the split.
    const { upper, rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);

    at("2026-09-20T08:00:00");
    useStore.getState().settleRestDay();
    useStore.getState().settleRestDay();
    expect(next()?.id).toBe(upper.id);
  });

  it("does nothing at all when the cursor is on a workout", async () => {
    const { upper } = await buildUL();
    useStore.getState().setNextCard(upper.id);
    expect(useStore.getState().restSince).toBeUndefined();

    at("2026-09-20T08:00:00");
    useStore.getState().settleRestDay();
    // A workout waits. Skipping Monday does not cost you Monday's Upper.
    expect(next()?.id).toBe(upper.id);
  });

  it("drops a clock left behind when the cursor moved off the rest", async () => {
    const { upper, rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);
    useStore.getState().setNextCard(upper.id);
    expect(useStore.getState().restSince).toBeUndefined();

    // Belt and braces: even if something wrote a stale date, settling clears it
    // rather than spending the workout the cursor is now on.
    useStore.setState({ restSince: "2026-09-01" });
    useStore.getState().settleRestDay();
    expect(useStore.getState().restSince).toBeUndefined();
    expect(next()?.id).toBe(upper.id);
  });

  it("starts today's clock for a rest that arrived without one", async () => {
    // An imported backup, which carries the cursor but not the clock. Spending
    // it immediately would take a day off the user never asked for.
    const { rest } = await buildUL();
    useStore.setState({ nextSlotId: rest.id, restSince: undefined });

    useStore.getState().settleRestDay();
    expect(next()?.id).toBe(rest.id);
    expect(useStore.getState().restSince).toBe("2026-09-13");

    at("2026-09-14T07:00:00");
    useStore.getState().settleRestDay();
    expect(next()?.id).not.toBe(rest.id);
  });

  it("persists the clock, so closing the app does not restart the day off", async () => {
    const { rest } = await buildUL();
    useStore.getState().setNextCard(rest.id);
    await new Promise((r) => setTimeout(r, 30));

    const settings = (await db.meta.get("settings")) as unknown as Record<string, unknown>;
    expect(settings.restSince).toBe("2026-09-13");
    expect(settings.nextSlotId).toBe(rest.id);
  });

  it("starts a clock when a workout ends onto a rest", async () => {
    // Not the user's split - his repeat keeps Rest out of the cycle - but a
    // split where Rest follows a workout directly is legal, and a rest the
    // cursor LANDED on is as taken as one chosen by hand.
    await buildUL();
    const s = useStore.getState();
    const push = s.addSplitCard({ name: "Push" })!;
    const rest2 = s.addSplitCard({ kind: "rest" })!;
    useStore.getState().setNextCard(push.id);
    useStore.getState().startWorkout("Push");
    useStore.getState().endWorkout();

    expect(next()?.id).toBe(rest2.id);
    expect(useStore.getState().restSince).toBe("2026-09-13");
  });
});
