import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDisplayName,
  loadTutorialState,
  markInstallOffered,
  markInstalledSeen,
  markTutorialDone,
  saveDisplayName,
  saveTutorialState,
  tutorialInterrupted,
  updateTutorialState,
} from "../tutorial-state";

const KEY = "trakt.tutorial";

beforeEach(() => {
  // Unstub FIRST: one test replaces localStorage with a throwing stub, and
  // clearing before restoring it clears the stub instead.
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("tutorial state", () => {
  it("is absent before anything happens", () => {
    expect(loadTutorialState()).toBeUndefined();
    expect(loadDisplayName()).toBeUndefined();
  });

  it("round-trips everything it stores", () => {
    saveTutorialState({
      joinedAt: 1,
      name: "Bob",
      startedAt: 2,
      stepId: "log-bodyweight",
      doneAt: 3,
      cardDismissedAt: 4,
      installedSeen: true,
      installOffered: true,
    });

    expect(loadTutorialState()).toEqual({
      joinedAt: 1,
      name: "Bob",
      startedAt: 2,
      stepId: "log-bodyweight",
      doneAt: 3,
      cardDismissedAt: 4,
      installedSeen: true,
      installOffered: true,
    });
  });

  it("refuses a record with no join date, and anything unparseable", () => {
    localStorage.setItem(KEY, JSON.stringify({ doneAt: 1 }));
    expect(loadTutorialState()).toBeUndefined();

    localStorage.setItem(KEY, "{not json");
    expect(loadTutorialState()).toBeUndefined();
  });

  it("drops a field of the wrong type rather than the whole record", () => {
    localStorage.setItem(KEY, JSON.stringify({ joinedAt: 1, doneAt: "yesterday", name: 7 }));
    expect(loadTutorialState()).toEqual({ joinedAt: 1 });
  });

  it("survives storage that throws, which is private browsing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });

    expect(loadTutorialState()).toBeUndefined();
    expect(() => markTutorialDone()).not.toThrow();
  });

  it("stamps the finish once, and clears the resume pointer with it", () => {
    // A finished tutorial has nowhere to resume to; leaving a pointer behind
    // would make the next run start half way through.
    updateTutorialState({ startedAt: 10, stepId: "save-set-2" });
    markTutorialDone();
    const first = loadTutorialState();
    expect(first?.doneAt).toBeTypeOf("number");
    expect(first?.stepId).toBeUndefined();

    markTutorialDone();
    expect(loadTutorialState()?.doneAt).toBe(first?.doneAt);
  });

  it("knows an interrupted run from a finished one and from no run at all", () => {
    expect(tutorialInterrupted()).toBe(false);

    updateTutorialState({ startedAt: 1, stepId: "connect-sheet" });
    expect(tutorialInterrupted()).toBe(true);

    markTutorialDone();
    expect(tutorialInterrupted()).toBe(false);
  });

  it("trims the name, and treats a blank one as no name", () => {
    saveDisplayName("  Bob  ");
    expect(loadDisplayName()).toBe("Bob");

    saveDisplayName("   ");
    expect(loadDisplayName()).toBeUndefined();
  });

  it("records the install being seen and being offered separately", () => {
    // On iOS the app cannot tick "installed" until the next launch from the
    // home screen, so the tutorial completes its step on the offer.
    markInstallOffered();
    expect(loadTutorialState()?.installOffered).toBe(true);
    expect(loadTutorialState()?.installedSeen).toBeUndefined();

    markInstalledSeen();
    expect(loadTutorialState()?.installedSeen).toBe(true);
  });
});
