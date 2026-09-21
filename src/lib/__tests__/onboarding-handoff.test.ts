import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHandoff,
  consumeTutorialStart,
  pendingHandoff,
  stageHandoff,
  stageTutorialStart,
  startPending,
} from "../onboarding-handoff";

beforeEach(() => {
  vi.useRealTimers();
  clearHandoff();
  consumeTutorialStart();
});

describe("the placement", () => {
  it("is absent until something is staged", () => {
    expect(pendingHandoff()).toBeUndefined();
  });

  it("survives being read, over and over", () => {
    // The card's effect is set up and torn down again immediately after it
    // mounts, because the page hydrates and the tree is regenerated. A
    // placement consumed on the first read left the second run with nothing,
    // the queued frame cancelled, and the card frozen at its origin.
    stageHandoff({ top: 224, left: 24, width: 342 });

    expect(pendingHandoff()).toEqual({ top: 224, left: 24, width: 342 });
    expect(pendingHandoff()).toEqual({ top: 224, left: 24, width: 342 });
  });

  it("goes when the flight is actually released", () => {
    stageHandoff({ top: 224, left: 24, width: 342 });
    clearHandoff();
    expect(pendingHandoff()).toBeUndefined();
  });

  it("goes stale, so a cold start replays nothing", () => {
    vi.useFakeTimers();
    stageHandoff({ top: 224, left: 24, width: 342 });

    vi.advanceTimersByTime(6_000);

    expect(pendingHandoff()).toBeUndefined();
  });
});

describe("the tutorial start", () => {
  it("survives being checked, and is claimed exactly once", () => {
    stageTutorialStart();

    expect(startPending()).toBe(true);
    expect(startPending()).toBe(true);

    // Two timers may both be scheduled; only one of them may start anything.
    expect(consumeTutorialStart()).toBe(true);
    expect(consumeTutorialStart()).toBe(false);
    expect(startPending()).toBe(false);
  });

  it("outlives the flight it waits on", () => {
    vi.useFakeTimers();
    stageTutorialStart();

    // Longer than the placement's own life, because it fires after the landing.
    vi.advanceTimersByTime(6_000);

    expect(startPending()).toBe(true);
  });

  it("gives up eventually rather than firing into a later session", () => {
    vi.useFakeTimers();
    stageTutorialStart();

    vi.advanceTimersByTime(25_000);

    expect(startPending()).toBe(false);
  });

  it("is independent of the placement", () => {
    stageTutorialStart();
    clearHandoff();
    expect(startPending()).toBe(true);
  });
});
