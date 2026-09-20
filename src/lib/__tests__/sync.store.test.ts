import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  loadDeviceId,
  loadSyncBase,
  saveSyncBase,
  saveSyncConfig,
  type SyncConfigMeta,
} from "../db";
import { useStore } from "../store";
import { useSyncStore } from "../sync-store";
import { buildBase, type SyncBase } from "../sync";
import { isLikelyExecUrl, setSyncFetch } from "../sync-client";

// Exercises the real Dexie paths (via fake-indexeddb) and the real store, with
// only the network faked. The point is the wiring: what gets sent, when a sync
// is refused, and what happens to the merge base on each outcome.

const CONFIG: SyncConfigMeta = {
  key: "syncConfig",
  url: "https://script.google.com/macros/s/AKfycbTEST/exec",
  secret: "test-secret",
  deviceId: "dev_test",
  enabled: true,
};

interface Sent {
  body: Record<string, unknown>;
}

/** Installs a fetch that records what was sent and replies with `reply`. */
function stubFetch(reply: unknown, sent: Sent[] = []): Sent[] {
  setSyncFetch((_url, init) => {
    sent.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Promise.resolve(new Response(JSON.stringify(reply)));
  });
  return sent;
}

async function resetAll() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.meta.clear(),
  ]);
  useSyncStore.setState({
    config: undefined,
    status: "off",
    lastSyncedAt: undefined,
    lastError: undefined,
    pending: false,
    hydrated: false,
    running: false,
    collisions: [],
    blockedReason: undefined,
    pendingCoachPlan: undefined,
  });
}

beforeEach(async () => {
  await resetAll();
  useStore.setState({ hydrated: false, sets: [], sessions: [], dailyLogs: [] });
});

describe("isLikelyExecUrl", () => {
  it("accepts a deployment URL", () => {
    expect(isLikelyExecUrl("https://script.google.com/macros/s/AKfycbX-9_a/exec")).toBe(true);
  });

  it("rejects the editor URL, which is the easy mistake to make", () => {
    // Pasting this instead of the /exec URL otherwise fails in a way that just
    // looks like sync being broken.
    expect(isLikelyExecUrl("https://script.google.com/u/0/home/projects/abc123/edit")).toBe(false);
  });

  it("rejects a non-Google URL outright", () => {
    expect(isLikelyExecUrl("https://example.com/exec")).toBe(false);
  });
});

describe("syncNow: refusing to run", () => {
  it("does nothing before the store has hydrated", async () => {
    // The store's default state is empty arrays. Pushing that would publish an
    // empty sheet, and against an existing base it reads as "deleted everything".
    const sent = stubFetch({ ok: true, revision: 1 });
    await saveSyncConfig(CONFIG);
    useSyncStore.setState({ config: CONFIG });

    await useSyncStore.getState().syncNow();

    expect(sent).toHaveLength(0);
  });

  it("does nothing when sync is switched off", async () => {
    const sent = stubFetch({ ok: true, revision: 1 });
    useStore.setState({ hydrated: true });
    useSyncStore.setState({ config: { ...CONFIG, enabled: false } });

    await useSyncStore.getState().syncNow();

    expect(sent).toHaveLength(0);
  });

  it("does not fetch while offline, and remembers that changes are waiting", async () => {
    const sent = stubFetch({ ok: true, revision: 1 });
    useStore.setState({ hydrated: true });
    useSyncStore.setState({ config: CONFIG });
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await useSyncStore.getState().syncNow();

    expect(sent).toHaveLength(0);
    expect(useSyncStore.getState().status).toBe("offline");
    expect(useSyncStore.getState().pending).toBe(true);
    spy.mockRestore();
  });
});

describe("syncNow: the push", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      slots: [{ id: "s_hb", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [{ id: "sess_1", splitSlotId: "s_hb", startedAt: 1_000, endedAt: 2_000 }],
      sets: [
        {
          id: "set_1",
          sessionId: "sess_1",
          exerciseId: "e_bench",
          weight: 225,
          reps: 5,
          loggedAt: 1_500,
        },
      ],
      dailyLogs: [],
    });
    useSyncStore.setState({ config: CONFIG });
  });

  it("sends the secret and device id, and forces the first sync", async () => {
    const sent = stubFetch({ ok: true, revision: 1 });

    await useSyncStore.getState().syncNow();

    expect(sent).toHaveLength(1);
    expect(sent[0].body.action).toBe("push");
    expect(sent[0].body.secret).toBe("test-secret");
    expect(sent[0].body.deviceId).toBe("dev_test");
    // No base means nothing to be stale against: this is the first publish.
    expect(sent[0].body.force).toBe(true);
  });

  it("sends the tabs, with the set resolved to readable names", async () => {
    const sent = stubFetch({ ok: true, revision: 1 });

    await useSyncStore.getState().syncNow();

    const tabs = sent[0].body.tabs as Record<string, unknown[][]>;
    expect(Object.keys(tabs).sort()).toEqual(["cardio", "daily", "plan", "sessions", "sets"]);
    expect(tabs.sets[1]).toContain("Bench Press");
    expect(tabs.sets[1]).toContain("Heavy Bench");
  });

  it("records the merge base only after the sheet confirms", async () => {
    stubFetch({ ok: true, revision: 7 });

    expect(await loadSyncBase()).toBeUndefined();
    await useSyncStore.getState().syncNow();

    const base = await loadSyncBase();
    expect(base?.revision).toBe(7);
    expect(base?.sets.set_1).toMatchObject({ weight: 225, reps: 5 });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(useSyncStore.getState().pending).toBe(false);
  });

  it("stops forcing once a base exists, and pulls before pushing", async () => {
    await saveSyncBase(buildBase(useStore.getState(), 4));
    const sent = stubFetch({ ok: true, revision: 4 });

    await useSyncStore.getState().syncNow();

    expect(sent.map((s) => s.body.action)).toEqual(["pull", "push"]);
    expect(sent[1].body.force).toBe(false);
    expect(sent[1].body.expectedRevision).toBe(4);
  });

  it("leaves the base untouched when the push fails", async () => {
    // Advancing it on a failed push would make every record that did not land
    // look like a sheet edit on the next merge.
    await saveSyncBase(buildBase(useStore.getState(), 4));
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify(
            body.action === "pull"
              ? { ok: true, revision: 4, tabs: {} }
              : { ok: false, error: "network" },
          ),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    expect((await loadSyncBase())?.revision).toBe(4);
    expect(useSyncStore.getState().status).toBe("error");
    expect(useSyncStore.getState().pending).toBe(true);
  });

  it("blocks rather than retrying when another device owns the sheet", async () => {
    stubFetch({ ok: false, error: "other-device", deviceId: "dev_other" });

    await useSyncStore.getState().syncNow();

    // "blocked" is what stops the engine retrying: no amount of retrying makes
    // a second device acceptable.
    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().lastError).toMatch(/another device/i);
  });

  it("blocks on a rejected secret", async () => {
    stubFetch({ ok: false, error: "bad-secret" });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().status).toBe("blocked");
  });

  it("reports an Apps Script error page as unreadable rather than crashing", async () => {
    setSyncFetch(() => Promise.resolve(new Response("<!DOCTYPE html><html>Sorry...")));

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().lastError).toMatch(/deployment URL/i);
  });

  it("survives the network throwing, without ever throwing itself", async () => {
    setSyncFetch(() => Promise.reject(new Error("connection reset")));

    await expect(useSyncStore.getState().syncNow()).resolves.toBeUndefined();
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("does not start a second cycle while one is running", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const sent: Sent[] = [];
    setSyncFetch((_url, init) => {
      sent.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });

    const first = useSyncStore.getState().syncNow();
    // syncNow reads the base out of IndexedDB before it reaches the network, so
    // give that a tick to land or the fetch has not happened yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);

    // A second cycle while the first is in flight must add nothing.
    await useSyncStore.getState().syncNow();
    expect(sent).toHaveLength(1);

    resolveFetch?.(new Response(JSON.stringify({ ok: true, revision: 1 })));
    await first;
  });
});

describe("the merge base and destructive actions", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      sets: [
        {
          id: "set_1",
          sessionId: "sess_1",
          exerciseId: "e_bench",
          weight: 225,
          reps: 5,
          loggedAt: 1_500,
        },
      ],
    });
  });

  it("clearAllData drops the base, so the next sync republishes", async () => {
    // Without this the base still describes a full history while the app is
    // empty, and the next sync reads that as the user having deleted
    // everything and wipes their real sheet. Reset is documented as a clean
    // slate for testing, so this path is entirely reachable.
    await saveSyncBase(buildBase(useStore.getState(), 3));
    expect(await loadSyncBase()).toBeDefined();

    await useStore.getState().clearAllData();

    expect(await loadSyncBase()).toBeUndefined();
  });

  it("importing a backup drops the base too", async () => {
    await saveSyncBase(buildBase(useStore.getState(), 3));

    await useStore.getState().importData({
      version: 4,
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],

      nutritionPhases: [],

      plannedDays: [],

      nextSlotId: undefined,
      unit: "lbs",
    });

    expect(await loadSyncBase()).toBeUndefined();
  });

  it("but the connection survives, so a restore does not silently disconnect", async () => {
    await saveSyncConfig(CONFIG);
    await saveSyncBase(buildBase(useStore.getState(), 3));

    await useStore.getState().clearAllData();

    const config = (await db.meta.get("syncConfig")) as SyncConfigMeta | undefined;
    expect(config?.url).toBe(CONFIG.url);
  });
});

describe("disconnect", () => {
  it("forgets both the connection and the base", async () => {
    await saveSyncConfig(CONFIG);
    await saveSyncBase({ revision: 1, sets: {}, sessions: {}, dailyLogs: {} } as SyncBase);
    useSyncStore.setState({ config: CONFIG, status: "idle" });

    await useSyncStore.getState().disconnect();

    expect(useSyncStore.getState().config).toBeUndefined();
    expect(useSyncStore.getState().status).toBe("off");
    expect(await db.meta.get("syncConfig")).toBeUndefined();
    expect(await loadSyncBase()).toBeUndefined();
  });
});

describe("syncNow: pulling sheet edits back", () => {
  /** A sheet reply carrying one editable set row. */
  function sheetWith(weight: unknown, revision = 4) {
    return {
      ok: true,
      revision,
      tabs: {
        sets: [
          ["ID", "Weight", "Reps", "RPE", "Setup Note"],
          ["set_1", weight, 5, "", ""],
        ],
      },
    };
  }

  beforeEach(async () => {
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      slots: [],
      sessions: [{ id: "sess_1", startedAt: 1_000, endedAt: 2_000 }],
      sets: [
        {
          id: "set_1",
          sessionId: "sess_1",
          exerciseId: "e_bench",
          weight: 225,
          reps: 5,
          loggedAt: 1_500,
        },
      ],
      dailyLogs: [],
    });
    useSyncStore.setState({ config: CONFIG, collisions: [] });
    await saveSyncBase(buildBase(useStore.getState(), 4));
  });

  it("does not pull on the first sync, when there is no base", async () => {
    await db.meta.delete("syncBase");
    const sent = stubFetch({ ok: true, revision: 1 });

    await useSyncStore.getState().syncNow();

    // Nothing to merge against, so a pull could not be interpreted anyway.
    expect(sent.map((s) => s.body.action)).toEqual(["push"]);
  });

  it("pulls before pushing, so a sheet edit is not overwritten by the push", async () => {
    // The ordering IS the correctness property here. Pushing first would write
    // the app's old value over the cell the user just typed in.
    const sent: Sent[] = [];
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({ body });
      return Promise.resolve(
        new Response(
          JSON.stringify(body.action === "pull" ? sheetWith(235) : { ok: true, revision: 5 }),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    expect(sent.map((s) => s.body.action)).toEqual(["pull", "push"]);
    // The edit reached the app...
    expect(useStore.getState().sets[0].weight).toBe(235);
    // ...and the push carried it back, so the next pull does not see it again.
    const tabs = sent[1].body.tabs as Record<string, unknown[][]>;
    expect(tabs.sets[1]).toContain(235);
  });

  it("writes the sheet's edit through to IndexedDB, not just to memory", async () => {
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify(body.action === "pull" ? sheetWith(235) : { ok: true, revision: 5 }),
        ),
      );
    });

    await useSyncStore.getState().syncNow();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await db.sets.get("set_1"))?.weight).toBe(235);
  });

  it("keeps the app's value and records a collision when both sides moved", async () => {
    useStore.setState({ sets: [{ ...useStore.getState().sets[0], weight: 245 }] });
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify(body.action === "pull" ? sheetWith(235) : { ok: true, revision: 5 }),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    expect(useStore.getState().sets[0].weight).toBe(245);
    expect(useSyncStore.getState().collisions).toHaveLength(1);
    expect(useSyncStore.getState().collisions[0]).toMatchObject({
      field: "weight",
      sheetValue: 235,
      appValue: 245,
    });
  });

  it("pushes against the revision the pull reported, not the stored one", async () => {
    // A base left behind by a failed push would otherwise read as stale forever.
    const sent: Sent[] = [];
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({ body });
      return Promise.resolve(
        new Response(
          JSON.stringify(body.action === "pull" ? sheetWith(225, 9) : { ok: true, revision: 10 }),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    expect(sent[1].body.expectedRevision).toBe(9);
  });

  it("re-runs the cycle once when the sheet moved between pull and push", async () => {
    const actions: string[] = [];
    let pushes = 0;
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      actions.push(String(body.action));
      if (body.action === "pull")
        return Promise.resolve(new Response(JSON.stringify(sheetWith(225))));
      pushes += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify(
            pushes === 1 ? { ok: false, error: "stale", revision: 6 } : { ok: true, revision: 7 },
          ),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    // Someone typed in the sheet during the push window, so the whole cycle
    // runs again rather than that edit being lost.
    expect(actions).toEqual(["pull", "push", "pull", "push"]);
    expect(useSyncStore.getState().status).toBe("idle");
  });

  it("gives up after one retry rather than looping forever", async () => {
    let pushes = 0;
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.action === "pull")
        return Promise.resolve(new Response(JSON.stringify(sheetWith(225))));
      pushes += 1;
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: "stale" })));
    });

    await useSyncStore.getState().syncNow();

    expect(pushes).toBe(2);
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("does not push at all when the pull fails", async () => {
    const sent = stubFetch({ ok: false, error: "network" });

    await useSyncStore.getState().syncNow();

    expect(sent.map((s) => s.body.action)).toEqual(["pull"]);
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("keeps unread collisions across a later clean sync", async () => {
    useSyncStore.setState({
      collisions: [
        { tab: "daily", key: "2026-08-12", field: "calories", sheetValue: 2100, appValue: 2400 },
      ],
    });
    setSyncFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify(body.action === "pull" ? sheetWith(225) : { ok: true, revision: 5 }),
        ),
      );
    });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().collisions).toHaveLength(1);
    useSyncStore.getState().dismissCollisions();
    expect(useSyncStore.getState().collisions).toHaveLength(0);
  });
});

describe("device id", () => {
  const EXEC = "https://script.google.com/macros/s/AKfycbTEST/exec";

  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      sets: [],
      sessions: [],
      dailyLogs: [],
      slots: [],
    });
  });

  it("survives a disconnect and reconnect", async () => {
    // The bug this exists for: the id used to live on the config row, so
    // disconnecting deleted it and reconnecting minted a new one that the sheet
    // then refused. Mistyping the URL once was enough to lock you out.
    stubFetch({ ok: true, revision: 1 });

    await useSyncStore.getState().connect(EXEC, "secret-one");
    const first = useSyncStore.getState().config?.deviceId;
    expect(first).toBeTruthy();

    await useSyncStore.getState().disconnect();
    await useSyncStore.getState().connect(EXEC, "secret-two");

    expect(useSyncStore.getState().config?.deviceId).toBe(first);
  });

  it("is not deleted by disconnect", async () => {
    stubFetch({ ok: true, revision: 1 });
    await useSyncStore.getState().connect(EXEC, "secret");
    const id = await loadDeviceId();

    await useSyncStore.getState().disconnect();

    expect(await loadDeviceId()).toBe(id);
  });

  it("survives clearing all data, because a reset is not a new browser", async () => {
    stubFetch({ ok: true, revision: 1 });
    await useSyncStore.getState().connect(EXEC, "secret");
    const id = await loadDeviceId();

    await useStore.getState().clearAllData();

    expect(await loadDeviceId()).toBe(id);
  });

  it("is generated once, not on every connect", async () => {
    stubFetch({ ok: true, revision: 1 });
    await useSyncStore.getState().connect(EXEC, "secret");
    const id = await loadDeviceId();
    await useSyncStore.getState().connect(EXEC, "secret");
    expect(await loadDeviceId()).toBe(id);
  });
});

describe("taking over a sheet", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      slots: [],
      sessions: [{ id: "sess_1", startedAt: 1_000, endedAt: 2_000 }],
      sets: [
        {
          id: "set_1",
          sessionId: "sess_1",
          exerciseId: "e_bench",
          weight: 225,
          reps: 5,
          loggedAt: 1_500,
        },
      ],
      dailyLogs: [],
    });
    useSyncStore.setState({ config: CONFIG });
  });

  it("records why it is blocked, as a code rather than as prose", async () => {
    // The UI branches on this. Matching on the message text would silently stop
    // working the first time someone reworded it.
    stubFetch({ ok: false, error: "other-device", deviceId: "dev_other" });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().blockedReason).toBe("other-device");
  });

  it("clears the blocked reason once a sync succeeds", async () => {
    stubFetch({ ok: false, error: "other-device" });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().blockedReason).toBe("other-device");

    stubFetch({ ok: true, revision: 2 });
    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().blockedReason).toBeUndefined();
    expect(useSyncStore.getState().status).toBe("idle");
  });

  it("sends takeover and force, so the script hands the sheet over", async () => {
    const sent = stubFetch({ ok: true, revision: 9 });

    await useSyncStore.getState().takeOverSheet();

    expect(sent).toHaveLength(1);
    expect(sent[0].body.action).toBe("push");
    expect(sent[0].body.takeover).toBe(true);
    expect(sent[0].body.force).toBe(true);
  });

  it("drops the old base first, since a takeover republishes wholesale", async () => {
    // The ancestor recorded against the previous owner's sheet describes a
    // history this device never had.
    await saveSyncBase(buildBase(useStore.getState(), 3));
    const sent = stubFetch({ ok: true, revision: 9 });

    await useSyncStore.getState().takeOverSheet();

    // No pull: with the base gone there is nothing to merge against.
    expect(sent.map((s) => s.body.action)).toEqual(["push"]);
    expect((await loadSyncBase())?.revision).toBe(9);
  });

  it("does nothing when no sheet is connected", async () => {
    useSyncStore.setState({ config: undefined });
    const sent = stubFetch({ ok: true, revision: 1 });

    await useSyncStore.getState().takeOverSheet();

    expect(sent).toHaveLength(0);
  });
});

describe("the plan tab", () => {
  const PLAN_TAB = [
    ["Kind", "Name", "Date", "Value", "Calories", "Order", "Card Kind", "Exercises"],
    ["meta", "issuedBy", "", "coach"],
    ["meta", "issuedAt", "", "2026-09-14T10:00:00.000Z"],
    ["phase", "Cut", "2026-09-20", "targets", 2200],
    ["card", "Upper", "", "", "", 0, "workout", "Bench Press"],
  ];

  /** A sheet that already has a base, so the cycle pulls before it pushes. */
  async function withBase() {
    await saveSyncBase(buildBase(useStore.getState(), 3));
  }

  beforeEach(async () => {
    await resetAll();
    await saveSyncConfig(CONFIG);
    useStore.setState({
      unit: "lbs",
      exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
      slots: [{ id: "s_hb", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      lastAcceptedPlanAt: undefined,
      hydrated: true,
    });
    useSyncStore.setState({ config: CONFIG });
  });

  it("publishes the app's own plan on the first sync, when the sheet holds nothing", async () => {
    const sent = stubFetch({ ok: true, revision: 1 });
    await useSyncStore.getState().syncNow();
    const tabs = sent[0].body.tabs as Record<string, unknown[][]>;
    expect(tabs.plan).toBeDefined();
    // Written as the client's, which is what marks it as not a coach's plan.
    expect(JSON.stringify(tabs.plan)).toContain("client");
  });

  it("leaves a pending coach plan in the sheet instead of overwriting it", async () => {
    // The bug this exists to prevent: the client's ordinary sync erasing the
    // plan its coach just sent, before the client ever saw the prompt.
    await withBase();
    const sent = stubFetch({ ok: true, revision: 4, tabs: { plan: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    const push = sent.find((x) => x.body.action === "push")!;
    const tabs = push.body.tabs as Record<string, unknown[][]>;
    expect(tabs.plan).toBeUndefined();
    expect(Object.keys(tabs).sort()).toEqual(["cardio", "daily", "sessions", "sets"]);
  });

  it("offers a coach plan the app has not absorbed", async () => {
    await withBase();
    stubFetch({ ok: true, revision: 4, tabs: { plan: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    const pending = useSyncStore.getState().pendingCoachPlan;
    expect(pending?.issuedBy).toBe("coach");
    expect(pending?.phases[0]).toMatchObject({ name: "Cut", calories: 2200 });
  });

  it("opens the review itself, so a plan cannot sit unnoticed", async () => {
    // With the launch sync, this is how a plan announces itself: the person
    // opens the app and the review is in front of them.
    await withBase();
    stubFetch({ ok: true, revision: 4, tabs: { plan: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().planReviewOpen).toBe(true);
  });

  it("does not reopen the review it was just dismissed from, until the next launch", async () => {
    // Dismissing is not deciding: the plan stays pending, the card and the tab
    // dot stay, and the next launch offers it again. What it must not do is
    // reappear over the app every time a sync runs.
    await withBase();
    stubFetch({ ok: true, revision: 4, tabs: { plan: PLAN_TAB } });
    await useSyncStore.getState().syncNow();
    useSyncStore.getState().setPlanReviewOpen(false);

    stubFetch({ ok: true, revision: 5, tabs: { plan: PLAN_TAB } });
    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().planReviewOpen).toBe(false);
    expect(useSyncStore.getState().pendingCoachPlan).toBeDefined();
  });

  it("does not re-offer a plan already accepted, and resumes publishing its own", async () => {
    // Re-reading the same tab on every sync has to be idempotent, or the app
    // would nag about the same plan forever.
    useStore.setState({ lastAcceptedPlanAt: "2026-09-14T10:00:00.000Z" });
    await withBase();
    const sent = stubFetch({ ok: true, revision: 4, tabs: { plan: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
    const push = sent.find((x) => x.body.action === "push")!;
    expect((push.body.tabs as Record<string, unknown[][]>).plan).toBeDefined();
  });

  it("does not offer a plan the app itself published", async () => {
    await withBase();
    const own = PLAN_TAB.map((r) => (r[1] === "issuedBy" ? ["meta", "issuedBy", "", "client"] : r));
    stubFetch({ ok: true, revision: 4, tabs: { plan: own } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
  });

  it("publishes its own plan over a plan tab it cannot read", async () => {
    await withBase();
    const sent = stubFetch({ ok: true, revision: 4, tabs: { plan: [["Nonsense"], ["rows"]] } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
    const push = sent.find((x) => x.body.action === "push")!;
    expect((push.body.tabs as Record<string, unknown[][]>).plan).toBeDefined();
  });
});
