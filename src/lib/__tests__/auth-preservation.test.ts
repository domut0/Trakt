import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, loadSyncConfig, saveSyncConfig, setDbReadOnly, type SyncConfigMeta } from "../db";
import { useSyncStore } from "../sync-store";
import { setGoogleTokenSource } from "../google-auth";
import { useStore } from "../store";
import { pullTabs } from "../sync-client-google";
const config: SyncConfigMeta = {
  key: "syncConfig",
  kind: "google",
  spreadsheetId: "existing-shared-sheet",
  deviceId: "existing-device",
  enabled: false,
  url: "",
  secret: "",
};
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
  );
beforeEach(async () => {
  setDbReadOnly(undefined);
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.exercises.put({ id: "lift", name: "Squat", type: "main" });
  await db.slots.put({ id: "slot", name: "Lower", rotationOrder: 0 });
  await db.sessions.bulkPut([
    {
      id: "active",
      startedAt: 123,
      splitSlotId: "slot",
      addedExerciseIds: ["lift"],
      substitutions: { original: "lift" },
      exerciseOrder: ["lift"],
    },
    {
      id: "cardio",
      startedAt: 100,
      endedAt: 200,
      kind: "cardio",
      durationMinutes: 20,
      distance: 3,
    },
  ]);
  await db.sets.put({
    id: "set",
    sessionId: "active",
    exerciseId: "lift",
    weight: 85,
    reps: 8,
    loggedAt: 123,
  });
  await db.dailyLogs.put({
    date: "2026-10-04",
    bodyweight: 83.4,
    steps: 0,
    calories: 2400,
    protein: 175,
    carbs: 250,
    fat: 70,
  });
  await db.coachClients.bulkPut([
    { id: "client-a", name: "Maya", kind: "google", spreadsheetId: "client-a-sheet" },
    { id: "client-b", name: "Alex", kind: "google", spreadsheetId: "client-b-sheet" },
  ]);
  const active = {
    key: "activeSession" as const,
    activeSessionId: "active",
    currentExerciseId: "lift",
  };
  const device = { key: "deviceId" as const, deviceId: config.deviceId };
  await db.meta.put(active);
  await db.meta.put(device);
  const base = {
    key: "syncBase" as const,
    base: {
      revision: 7,
      sets: { set: { weight: 85, reps: 8 } },
      sessions: { active: {} },
      dailyLogs: { "2026-10-04": { bodyweight: 83.4, steps: 0 } },
    },
  };
  await db.meta.put(base);
  await saveSyncConfig(config);
  useSyncStore.setState({
    config,
    running: false,
    status: "blocked",
    blockedReason: "needs-consent",
  });
  useStore.setState({ hydrated: true, activeSessionId: "active" });
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client");
});
afterEach(() => {
  setGoogleTokenSource(undefined);
  setDbReadOnly(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("authorization preserves existing fitness and coach data", () => {
  it("reconnects the existing sheet without touching any durable record or creating a spreadsheet", async () => {
    const before = await snapshot();
    setGoogleTokenSource(async () => "fake-access-only");
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(await useSyncStore.getState().reauthorize()).toEqual({ ok: true });
    expect(await snapshot()).toEqual(before);
    expect(await loadSyncConfig()).toEqual(config);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["needs-consent", "network", "missing-refresh-token"])(
    "preserves every durable table when authorization fails (%s)",
    async (reason) => {
      const before = await snapshot();
      setGoogleTokenSource(async () => {
        throw new Error(reason);
      });
      expect((await useSyncStore.getState().reauthorize()).ok).toBe(false);
      expect(await snapshot()).toEqual(before);
      expect(useStore.getState().activeSessionId).toBe("active");
    },
  );
  it("refreshes once and silently retries a Google 401 against the same spreadsheet", async () => {
    const interactive: boolean[] = [];
    setGoogleTokenSource(async (flag) => {
      interactive.push(flag);
      return interactive.length === 1 ? "expired" : "renewed";
    });
    const network = vi.fn(async (url: string) => {
      expect(url).toContain("existing-shared-sheet");
      return new Response(JSON.stringify({ valueRanges: [] }), {
        status: network.mock.calls.length === 1 ? 401 : 200,
      });
    });
    vi.stubGlobal("fetch", network);
    expect((await pullTabs(config.spreadsheetId!, { interactive: true })).ok).toBe(true);
    expect(interactive).toEqual([true, false]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(
      network.mock.calls.every((call) => String(call[0]).includes("existing-shared-sheet")),
    ).toBe(true);
  });
});
