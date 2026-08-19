import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, loadSyncBase, saveSyncBase, saveSyncConfig, type SyncConfigMeta } from "../db";
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
    db.habits.clear(),
    db.habitEntries.clear(),
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
      habits: [],
      habitEntries: [],
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
    expect(Object.keys(tabs).sort()).toEqual(["cardio", "daily", "habits", "sessions", "sets"]);
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

  it("stops forcing once a base exists, and sends its revision", async () => {
    await saveSyncBase(buildBase(useStore.getState(), 4));
    const sent = stubFetch({ ok: true, revision: 5 });

    await useSyncStore.getState().syncNow();

    expect(sent[0].body.force).toBe(false);
    expect(sent[0].body.expectedRevision).toBe(4);
  });

  it("leaves the base untouched when the push fails", async () => {
    // Advancing it on a failed push would make every record that did not land
    // look like a sheet edit on the next merge.
    const original = buildBase(useStore.getState(), 4);
    await saveSyncBase(original);
    stubFetch({ ok: false, error: "network" });

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
      habits: [],
      habitEntries: [],
      targetProfiles: [{ id: "tp_default", name: "Default" }],
      weekdayTargets: Array(7).fill("tp_default"),
      targetsEnabled: false,
      habitsEnabled: false,
      toolsEnabled: false,
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
