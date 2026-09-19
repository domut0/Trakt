import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPendingCoach, savePendingCoach } from "../pending-coach";

describe("the pending coach", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips, including the shared mark", () => {
    savePendingCoach({ name: "Marcus", email: "m@gmail.com", sharedAt: 5 });
    expect(loadPendingCoach()).toEqual({ name: "Marcus", email: "m@gmail.com", sharedAt: 5 });
  });

  it("is absent when nothing, or nothing readable, is stored", () => {
    expect(loadPendingCoach()).toBeUndefined();
    localStorage.setItem("trakt.pendingCoach", "{not json");
    expect(loadPendingCoach()).toBeUndefined();
    localStorage.setItem("trakt.pendingCoach", JSON.stringify({ email: "m@gmail.com" }));
    expect(loadPendingCoach()).toBeUndefined();
  });

  it("survives storage that throws, as private browsing can", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPendingCoach()).toBeUndefined();
    expect(() => savePendingCoach({ name: "Marcus" })).not.toThrow();
  });
});
