import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLikelyEmail, loadCoachProfile, saveCoachProfile } from "../coach-profile";

describe("coach profile", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a profile through save/load", () => {
    const profile = { name: "Marcus", email: "marcus@gmail.com" };
    saveCoachProfile(profile);
    expect(loadCoachProfile()).toEqual(profile);
  });

  it("returns empty strings when nothing is stored", () => {
    expect(loadCoachProfile()).toEqual({ name: "", email: "" });
  });

  it("returns empty strings when the stored value is not JSON", () => {
    localStorage.setItem("trakt.coachProfile", "not-json");
    expect(loadCoachProfile()).toEqual({ name: "", email: "" });
  });

  it("does not throw when localStorage.getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(loadCoachProfile()).toEqual({ name: "", email: "" });
    } finally {
      spy.mockRestore();
    }
  });

  describe("isLikelyEmail", () => {
    it.each(["a@b.co", " coach@gmail.com "])("accepts %s", (email) => {
      expect(isLikelyEmail(email)).toBe(true);
    });

    it.each(["", "coach", "a@b", "a b@c.com", "@b.com", "a@@b.com"])("rejects %s", (email) => {
      expect(isLikelyEmail(email)).toBe(false);
    });
  });
});
