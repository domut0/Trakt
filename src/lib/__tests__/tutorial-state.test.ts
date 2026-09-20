import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTutorialState,
  markInstalledSeen,
  markTutorialDone,
  saveTutorialState,
} from "../tutorial-state";

describe("tutorial state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips full tutorial progress", () => {
    const state = {
      joinedAt: 1000,
      doneAt: 2000,
      cardDismissedAt: 3000,
      installedSeen: true,
    };
    saveTutorialState(state);
    expect(loadTutorialState()).toEqual(state);
  });

  it("round-trips minimal tutorial progress with only joinedAt", () => {
    saveTutorialState({ joinedAt: 1234 });
    expect(loadTutorialState()).toEqual({ joinedAt: 1234 });
  });

  it("returns undefined when nothing is stored", () => {
    expect(loadTutorialState()).toBeUndefined();
  });

  it("tolerates corrupt or non-JSON data in localStorage", () => {
    localStorage.setItem("trakt.tutorial", "{corrupted json");
    expect(loadTutorialState()).toBeUndefined();

    localStorage.setItem("trakt.tutorial", JSON.stringify({ wrongField: "test" }));
    expect(loadTutorialState()).toBeUndefined();

    localStorage.setItem("trakt.tutorial", JSON.stringify(42));
    expect(loadTutorialState()).toBeUndefined();
  });

  it("tolerates storage access throwing, as private browsing modes do", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QuotaExceededError / access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError / access denied");
    });

    expect(loadTutorialState()).toBeUndefined();
    expect(() => saveTutorialState({ joinedAt: 100 })).not.toThrow();
    expect(() => markTutorialDone()).not.toThrow();
    expect(() => markInstalledSeen()).not.toThrow();
  });

  it("marks tutorial done idempotently without altering an existing completion timestamp", () => {
    markTutorialDone();
    const first = loadTutorialState();
    expect(first?.doneAt).toBeTypeOf("number");
    expect(first?.joinedAt).toBeTypeOf("number");

    const originalDoneAt = first!.doneAt;

    // Advance clock or second invocation
    markTutorialDone();
    const second = loadTutorialState();
    expect(second?.doneAt).toBe(originalDoneAt);
  });

  it("marks installed seen idempotently", () => {
    saveTutorialState({ joinedAt: 500, doneAt: 600 });
    markInstalledSeen();

    const first = loadTutorialState();
    expect(first?.installedSeen).toBe(true);
    expect(first?.doneAt).toBe(600);
    expect(first?.joinedAt).toBe(500);

    // Call again to verify idempotency
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    markInstalledSeen();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(loadTutorialState()?.installedSeen).toBe(true);
  });
});
