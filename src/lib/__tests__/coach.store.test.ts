import { beforeEach, describe, expect, it } from "vitest";
import { db, dbReadOnlyReason, loadCoachClients, type CoachClient } from "../db";
import { useCoachStore } from "../coach-store";
import { useStore } from "../store";
import { useSyncStore } from "../sync-store";
import { buildSheetTabs, type SyncSource } from "../sync";
import { setSyncFetch } from "../sync-client";

/**
 * Coach mode's two guarantees, which are the only things in it that can lose
 * data: the coach's own state comes back exactly as it was, and nothing the
 * coach does while looking at a client can reach their own database or their
 * own sheet.
 */

const CLIENT: CoachClient = {
  id: "c_bob",
  name: "Bob",
  kind: "appsScript",
  url: "https://script.google.com/macros/s/AKfycbBOB/exec",
  secret: "bob-secret",
};

const DAY = new Date(2026, 8, 12, 9, 30, 0).getTime();

/** A client's sheet, rendered the way their own app would render it. */
const BOB_SHEET: SyncSource = {
  unit: "kg",
  exercises: [{ id: "e1", name: "Front Squat", type: "main" }],
  slots: [{ id: "s1", name: "Legs", rotationOrder: 0 }],
  sessions: [{ id: "sess_bob", splitSlotId: "s1", startedAt: DAY, endedAt: DAY + 3_600_000 }],
  sets: [
    { id: "set_bob", sessionId: "sess_bob", exerciseId: "e1", weight: 100, reps: 5, loggedAt: DAY },
  ],
  dailyLogs: [{ date: "2026-09-12", calories: 2100, steps: 14000 }],
  nutritionPhases: [],
  plannedDays: [],
};

/** The coach's own state, deliberately different from Bob's in every field. */
const COACH_STATE = {
  unit: "lbs" as const,
  exercises: [{ id: "my_e", name: "Bench Press", type: "main" as const }],
  slots: [{ id: "my_s", name: "Upper", rotationOrder: 0 }],
  sessions: [{ id: "my_sess", splitSlotId: "my_s", startedAt: DAY }],
  sets: [
    { id: "my_set", sessionId: "my_sess", exerciseId: "my_e", weight: 315, reps: 3, loggedAt: DAY },
  ],
  dailyLogs: [{ date: "2026-09-12", calories: 3200 }],
  nutritionPhases: [],
  plannedDays: [],
  activeSessionId: "my_sess",
  currentExerciseId: "my_e",
  currentBlock: undefined,
  nextSlotId: "my_s",
  restSince: undefined,
  lastAcceptedPlanAt: undefined,
  hydrated: true,
};

function stubClientSheet(source: SyncSource = BOB_SHEET) {
  setSyncFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          revision: 1,
          tabs: buildSheetTabs(source, { issuedAt: "2026-09-10T08:00:00.000Z" }),
        }),
      ),
    ),
  );
}

beforeEach(async () => {
  setDbReadOnlyOff();
  await db.coachClients.clear();
  useCoachStore.setState({
    enabled: false,
    clients: [],
    hydrated: false,
    viewing: undefined,
    loading: false,
    lastError: undefined,
  });
  useStore.setState({ ...COACH_STATE });
  await useCoachStore.getState().addClient(CLIENT);
});

function setDbReadOnlyOff() {
  useCoachStore.getState().exitClientView();
}

describe("the client list", () => {
  it("persists a client and reads them back", async () => {
    expect(await loadCoachClients()).toHaveLength(1);
    useCoachStore.setState({ clients: [], hydrated: false });
    await useCoachStore.getState().hydrate();
    expect(useCoachStore.getState().clients[0].name).toBe("Bob");
  });

  it("turns coach mode on for anyone who has a client", async () => {
    useCoachStore.setState({ clients: [], hydrated: false, enabled: false });
    await useCoachStore.getState().hydrate();
    expect(useCoachStore.getState().enabled).toBe(true);
  });

  it("removes a client", async () => {
    await useCoachStore.getState().removeClient("c_bob");
    expect(useCoachStore.getState().clients).toEqual([]);
    expect(await loadCoachClients()).toEqual([]);
  });
});

describe("entering a client's view", () => {
  it("puts the client's data into the screens the app already has", async () => {
    stubClientSheet();
    const ok = await useCoachStore.getState().enterClientView("c_bob");

    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0].weight).toBe(100);
    expect(state.exercises.map((e) => e.name)).toEqual(["Front Squat"]);
    expect(state.dailyLogs[0].calories).toBe(2100);
    expect(state.unit).toBe("kg");
  });

  it("holds the database read-only for the whole visit", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    expect(dbReadOnlyReason()).toBe("viewing Bob");
  });

  it("never leaves the coach inside their own workout", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    expect(useStore.getState().activeSessionId).toBeUndefined();
  });

  it("records when the snapshot was pulled, so the banner can say", async () => {
    stubClientSheet();
    const before = Date.now();
    await useCoachStore.getState().enterClientView("c_bob");
    expect(useCoachStore.getState().viewing!.pulledAt).toBeGreaterThanOrEqual(before);
  });

  it("reports an unreachable sheet without touching the coach's state", async () => {
    setSyncFetch(() => Promise.reject(new Error("offline")));
    const ok = await useCoachStore.getState().enterClientView("c_bob");

    expect(ok).toBe(false);
    expect(useCoachStore.getState().lastError).toBe("unreachable");
    expect(useCoachStore.getState().viewing).toBeUndefined();
    // The critical half: a failed entry must not leave writes disabled, or the
    // app would silently stop saving for the rest of the session.
    expect(dbReadOnlyReason()).toBeUndefined();
    expect(useStore.getState().sets[0].weight).toBe(315);
  });

  it("refuses a Google-backed client until that transport exists", async () => {
    await useCoachStore.getState().addClient({
      id: "c_ann",
      name: "Ann",
      kind: "google",
      spreadsheetId: "sheet123",
    });
    expect(await useCoachStore.getState().enterClientView("c_ann")).toBe(false);
    expect(useCoachStore.getState().lastError).toBe("not-configured");
    expect(dbReadOnlyReason()).toBeUndefined();
  });
});

describe("leaving a client's view", () => {
  it("restores the coach's own data exactly", async () => {
    stubClientSheet();
    const before = JSON.stringify(useStore.getState().sets);

    await useCoachStore.getState().enterClientView("c_bob");
    useCoachStore.getState().exitClientView();

    const state = useStore.getState();
    expect(JSON.stringify(state.sets)).toBe(before);
    expect(state.unit).toBe("lbs");
    expect(state.exercises.map((e) => e.name)).toEqual(["Bench Press"]);
    expect(state.dailyLogs[0].calories).toBe(3200);
  });

  it("gives the coach their workout back", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    useCoachStore.getState().exitClientView();
    expect(useStore.getState().activeSessionId).toBe("my_sess");
    expect(useStore.getState().nextSlotId).toBe("my_s");
  });

  it("re-enables writing", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    useCoachStore.getState().exitClientView();
    expect(dbReadOnlyReason()).toBeUndefined();
  });

  it("leaves the view when the client being viewed is removed", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    await useCoachStore.getState().removeClient("c_bob");
    expect(useCoachStore.getState().viewing).toBeUndefined();
    expect(useStore.getState().unit).toBe("lbs");
  });
});

describe("sync while viewing a client", () => {
  it("refuses to run, so a client's log never reaches the coach's sheet", async () => {
    // Without this the coach's sheet would be overwritten with the client's
    // data and that would become the merge base -- so the next sync would read
    // the coach's real history as deletions.
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");

    let pushed = false;
    setSyncFetch(() => {
      pushed = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true, revision: 1 })));
    });
    useSyncStore.setState({
      config: {
        key: "syncConfig",
        url: "https://script.google.com/macros/s/AKfycbCOACH/exec",
        secret: "coach-secret",
        deviceId: "dev_coach",
        enabled: true,
      },
      running: false,
    });

    await useSyncStore.getState().syncNow();

    expect(pushed).toBe(false);
    expect(useSyncStore.getState().pending).toBe(true);
  });
});

describe("writing a plan back to a client", () => {
  /** Captures what was POSTed, so the test can assert on the request itself. */
  function captureSave(reply: unknown = { ok: true, revision: 1 }) {
    const sent: Array<Record<string, unknown>> = [];
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      if (body.action === "pull") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, revision: 1, tabs: buildSheetTabs(BOB_SHEET, undefined) }),
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(reply)));
    });
    return sent;
  }

  it("reports nothing to save before the coach has changed anything", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    expect(useCoachStore.getState().pendingChanges()).toEqual([]);
  });

  it("notices an edit made through the ordinary Plan screen", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");

    // Exactly what the Plan tab does: coach mode put the client's plan in the
    // store, so editing the store IS editing the client's plan.
    useStore.setState({
      nutritionPhases: [
        { id: "p1", startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2200 },
      ],
    });

    const changes = useCoachStore.getState().pendingChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ area: "Nutrition", kind: "added" });
    expect(changes[0].detail).toContain("2200");
  });

  it("sends only the plan tab, never the client's log", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    const sent = captureSave();

    useStore.setState({
      nutritionPhases: [
        { id: "p1", startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2200 },
      ],
    });
    expect(await useCoachStore.getState().saveClientPlan()).toBe(true);

    const save = sent.find((b) => b.action === "putPlan")!;
    expect(save).toBeDefined();
    // A coach must never rewrite a client's log, nor claim their sheet.
    expect(sent.some((b) => b.action === "push")).toBe(false);
    expect(Object.keys(save.tabs as object)).toEqual(["plan"]);
    expect(JSON.stringify(save.tabs)).toContain("coach");
  });

  it("goes quiet after a successful save, rather than staying lit on sent work", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    captureSave();

    useStore.setState({
      nutritionPhases: [
        { id: "p1", startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2200 },
      ],
    });
    await useCoachStore.getState().saveClientPlan();

    expect(useCoachStore.getState().pendingChanges()).toEqual([]);
  });

  it("keeps the changes pending when the sheet refuses", async () => {
    stubClientSheet();
    await useCoachStore.getState().enterClientView("c_bob");
    captureSave({ ok: false, error: "busy" });

    useStore.setState({
      nutritionPhases: [
        { id: "p1", startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2200 },
      ],
    });

    expect(await useCoachStore.getState().saveClientPlan()).toBe(false);
    expect(useCoachStore.getState().lastError).toBe("unreachable");
    // Losing the coach's edits on a failed send would be the worst outcome here.
    expect(useCoachStore.getState().pendingChanges()).toHaveLength(1);
  });

  it("saves nothing when no client is open", async () => {
    const sent = captureSave();
    expect(await useCoachStore.getState().saveClientPlan()).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("opening a client with an existing plan", () => {
  it("shows no pending changes, even though their sheet carries a plan", async () => {
    // The baseline is read off the screen, so opening a client is never itself
    // a change -- whether their sheet has a plan tab or only implied cards.
    stubClientSheet({
      ...BOB_SHEET,
      nutritionPhases: [
        { id: "p_cut", startsOn: "2026-09-20", name: "Cut", kind: "targets", calories: 2100 },
      ],
      plannedDays: [{ date: "2026-09-22", splitSlotId: "s1" }],
    });

    await useCoachStore.getState().enterClientView("c_bob");

    expect(useStore.getState().nutritionPhases).toHaveLength(1);
    expect(useCoachStore.getState().pendingChanges()).toEqual([]);
  });
});
