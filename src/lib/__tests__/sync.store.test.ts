import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  loadDeviceId,
  loadSyncBase,
  saveSyncBase,
  saveSyncConfig,
  setDbReadOnly,
  type SyncConfigMeta,
} from "../db";
import type { CellValue } from "../csv";
import { useStore } from "../store";
import { useSyncStore } from "../sync-store";
import { buildBase, SHEET_TABS, type SyncBase } from "../sync";
import { clearGoogleToken, setGoogleTokenSource } from "../google-auth";

// Exercises the real Dexie paths (via fake-indexeddb) and the real store, with
// only Google faked. The point is the wiring: what gets sent, when a sync is
// refused, and what happens to the merge base on each outcome.
//
// The transport is the Sheets API, which means three calls rather than one
// request with an `action`: values:batchGet to read, then values:batchClear and
// values:batchUpdate to write. `fakeSheets` below is the whole protocol.

const CONFIG: SyncConfigMeta = {
  key: "syncConfig",
  kind: "google",
  spreadsheetId: "sheet_test",
  url: "",
  secret: "",
  deviceId: "dev_test",
  enabled: true,
};

/** The tab order `pullTabs` asks for, which is how it matches replies: by index. */
const TAB_ORDER = [
  SHEET_TABS.sets,
  SHEET_TABS.sessions,
  SHEET_TABS.daily,
  SHEET_TABS.cardio,
  SHEET_TABS.plan,
  SHEET_TABS.meta,
];

type Tabs = Record<string, CellValue[][]>;

interface FakeSheets {
  /** "get" | "clear" | "update" | "create", in the order they were called. */
  calls: string[];
  /** The tabs the last write sent, keyed by tab name. */
  pushed: () => Tabs;
  /** The ranges the last clear named. */
  cleared: () => string[];
}

/**
 * The Sheets API, as far as this app uses it.
 *
 * `tabs` is what a read returns. `readStatus` and `writeStatus` make either
 * half fail: 401 for a lapsed grant, 403 for a file no longer shared, 500 for
 * a bad day at Google.
 */
function fakeSheets({
  tabs = {},
  readStatus = 200,
  writeStatus = 200,
  onCall,
}: {
  tabs?: Tabs;
  readStatus?: number;
  writeStatus?: number;
  onCall?: (kind: string) => void;
} = {}): FakeSheets {
  const calls: string[] = [];
  const writes: Array<Record<string, unknown>> = [];
  const clears: Array<Record<string, unknown>> = [];

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const kind = url.includes("values:batchGet")
      ? "get"
      : url.includes("values:batchClear")
        ? "clear"
        : url.includes("values:batchUpdate")
          ? "update"
          : "create";
    calls.push(kind);
    onCall?.(kind);

    if (kind === "get") {
      if (readStatus !== 200) return Promise.resolve(new Response("{}", { status: readStatus }));
      const valueRanges = TAB_ORDER.map((name) => ({ values: tabs[name] ?? [] }));
      return Promise.resolve(new Response(JSON.stringify({ valueRanges })));
    }
    if (kind === "clear") clears.push(body);
    if (kind === "update") writes.push(body);
    if (writeStatus !== 200) return Promise.resolve(new Response("{}", { status: writeStatus }));
    if (kind === "create") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ spreadsheetId: "new_sheet", spreadsheetUrl: "https://sheet" }),
        ),
      );
    }
    return Promise.resolve(new Response("{}"));
  });

  return {
    calls,
    pushed: () => {
      const last = writes[writes.length - 1];
      const data = (last?.data ?? []) as Array<{ range: string; values: CellValue[][] }>;
      return Object.fromEntries(data.map((d) => [d.range, d.values]));
    },
    cleared: () => (clears[clears.length - 1]?.ranges ?? []) as string[],
  };
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
    planReviewOpen: false,
  });
  setGoogleTokenSource(() => Promise.resolve("fake-token"));
}

beforeEach(async () => {
  // Every path through connectGoogle refuses before it starts when the build
  // carries no OAuth client id, which is exactly what a test run is. Without
  // this the three tests that connect a sheet assert against an early return.
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  await resetAll();
  useStore.setState({ hydrated: false, sets: [], sessions: [], dailyLogs: [] });
});

afterEach(() => {
  setDbReadOnly(undefined);
  vi.unstubAllEnvs();
});

describe("syncNow: refusing to run", () => {
  it.each(["loading the base", "pulling Google"])(
    "stops an in-flight sync if client view opens while %s",
    async (moment) => {
      const ownLogs = [{ date: "2026-10-01", calories: 2200 }];
      const clientLogs = [{ date: "2026-10-01", calories: 3100 }];
      useStore.setState({ hydrated: true, dailyLogs: ownLogs });
      await db.dailyLogs.bulkPut(ownLogs);
      const originalBase = buildBase(useStore.getState(), 3);
      await saveSyncBase(originalBase);
      useSyncStore.setState({ config: CONFIG });
      const openClient = () => {
        setDbReadOnly("viewing Client");
        useStore.setState({ dailyLogs: clientLogs });
      };
      const api = fakeSheets({
        onCall: (kind) => {
          if (moment === "pulling Google" && kind === "get") openClient();
        },
      });
      const pending = useSyncStore.getState().syncNow();
      if (moment === "loading the base") openClient();
      await pending;

      expect(api.calls).toEqual(moment === "pulling Google" ? ["get"] : []);
      expect(await db.dailyLogs.toArray()).toEqual(ownLogs);
      expect(await loadSyncBase()).toEqual(originalBase);
      expect(useStore.getState().dailyLogs).toBe(clientLogs);
      expect(useSyncStore.getState()).toMatchObject({ pending: true, running: false });
    },
  );

  it("does nothing before the store has hydrated", async () => {
    // Pushing an empty store would publish an empty sheet, and once a base
    // exists that reads as the user having deleted their entire history.
    const api = fakeSheets();
    useSyncStore.setState({ config: CONFIG });
    useStore.setState({ hydrated: false });

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual([]);
  });

  it("does nothing when sync is switched off", async () => {
    const api = fakeSheets();
    useSyncStore.setState({ config: { ...CONFIG, enabled: false } });
    useStore.setState({ hydrated: true });

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual([]);
  });

  it("does not reach the network while offline, and remembers work is waiting", async () => {
    const api = fakeSheets();
    useSyncStore.setState({ config: CONFIG });
    useStore.setState({ hydrated: true });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual([]);
    expect(useSyncStore.getState().status).toBe("offline");
    expect(useSyncStore.getState().pending).toBe(true);
    vi.restoreAllMocks();
  });

  it("blocks an Apps Script connection instead of failing at it forever", async () => {
    // The transport this version dropped. Retrying cannot help; Settings offers
    // the reconnect that can, and the sheet stays in the person's Drive.
    const api = fakeSheets();
    useSyncStore.setState({
      config: { ...CONFIG, kind: undefined, spreadsheetId: undefined, url: "https://…/exec" },
    });
    useStore.setState({ hydrated: true });

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual([]);
    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().lastError).toMatch(/Google sign-in/i);
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

  it("sends the tabs, with the set resolved to readable names", async () => {
    const api = fakeSheets();

    await useSyncStore.getState().syncNow();

    const tabs = api.pushed();
    expect(Object.keys(tabs).sort()).toEqual(["cardio", "daily", "plan", "sessions", "sets"]);
    expect(tabs.sets[1]).toContain("Bench Press");
    expect(tabs.sets[1]).toContain("Heavy Bench");
  });

  it("clears each tab it is about to write, or deleted rows would survive", async () => {
    const api = fakeSheets();

    await useSyncStore.getState().syncNow();

    expect(api.cleared().sort()).toEqual(Object.keys(api.pushed()).sort());
  });

  it("records the merge base only after the sheet confirms", async () => {
    fakeSheets();

    expect(await loadSyncBase()).toBeUndefined();
    await useSyncStore.getState().syncNow();

    const base = await loadSyncBase();
    expect(base?.sets.set_1).toMatchObject({ weight: 225, reps: 5 });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(useSyncStore.getState().pending).toBe(false);
  });

  it("pulls before pushing once a base exists", async () => {
    await saveSyncBase(buildBase(useStore.getState(), 4));
    const api = fakeSheets();

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual(["get", "clear", "update"]);
  });

  it("does not pull on the first sync, when there is no base", async () => {
    const api = fakeSheets();

    await useSyncStore.getState().syncNow();

    // Nothing to merge against, so a pull could not be interpreted anyway.
    expect(api.calls).toEqual(["clear", "update"]);
  });

  it("leaves the base untouched when the push fails", async () => {
    // Advancing it on a failed push would make every record that did not land
    // look like a sheet edit on the next merge.
    await saveSyncBase(buildBase(useStore.getState(), 4));
    fakeSheets({ writeStatus: 500 });

    await useSyncStore.getState().syncNow();

    expect((await loadSyncBase())?.revision).toBe(4);
    expect(useSyncStore.getState().status).toBe("error");
    expect(useSyncStore.getState().pending).toBe(true);
  });

  it("blocks on a sheet that is no longer shared, rather than retrying it", async () => {
    fakeSheets({ writeStatus: 403 });

    await useSyncStore.getState().syncNow();

    // "blocked" is what stops the engine retrying: no amount of retrying gets
    // access back.
    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().lastError).toMatch(/no longer shared/i);
  });

  it("blocks on a lapsed grant, because only a tap can clear it", async () => {
    fakeSheets({ writeStatus: 401 });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().status).toBe("blocked");
    expect(useSyncStore.getState().blockedReason).toBe("needs-consent");
  });

  it("survives the network throwing, without ever throwing itself", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("connection reset")));

    await expect(useSyncStore.getState().syncNow()).resolves.toBeUndefined();
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("does not start a second cycle while one is running", async () => {
    // Held open: the first call never settles until this test lets it, which
    // is the whole window a second cycle could slip into.
    const held: Array<(value: Response) => void> = [];
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return new Promise<Response>((resolve) => held.push(resolve));
    });

    const first = useSyncStore.getState().syncNow();
    // syncNow reads the base out of IndexedDB before it reaches the network, so
    // give that a tick to land or the fetch has not happened yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);

    // A second cycle while the first is in flight must add nothing.
    await useSyncStore.getState().syncNow();
    expect(calls).toBe(1);

    // Release everything the cycle asked for, including the calls the push
    // makes once the pull returns.
    const release = () => {
      while (held.length > 0) held.shift()?.(new Response("{}"));
      if (useSyncStore.getState().running) setTimeout(release, 5);
    };
    release();
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
    // everything and wipes their real sheet.
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
      templates: [],
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
    expect(config?.spreadsheetId).toBe(CONFIG.spreadsheetId);
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
  /** A sheet holding one editable set row. */
  function sheetWith(weight: unknown): Tabs {
    return {
      [SHEET_TABS.sets]: [
        ["ID", "Weight", "Reps", "RPE", "Setup Note"],
        ["set_1", weight as CellValue, 5, "", ""],
      ],
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

  it("pulls before pushing, so a sheet edit is not overwritten by the push", async () => {
    // The ordering IS the correctness property here. Pushing first would write
    // the app's old value over the cell the user just typed in.
    const api = fakeSheets({ tabs: sheetWith(235) });

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual(["get", "clear", "update"]);
    // The edit reached the app...
    expect(useStore.getState().sets[0].weight).toBe(235);
    // ...and the push carried it back, so the next pull does not see it again.
    expect(api.pushed().sets[1]).toContain(235);
  });

  it("writes the sheet's edit through to IndexedDB, not just to memory", async () => {
    fakeSheets({ tabs: sheetWith(235) });

    await useSyncStore.getState().syncNow();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await db.sets.get("set_1"))?.weight).toBe(235);
  });

  it("keeps the app's value and records a collision when both sides moved", async () => {
    useStore.setState({ sets: [{ ...useStore.getState().sets[0], weight: 245 }] });
    fakeSheets({ tabs: sheetWith(235) });

    await useSyncStore.getState().syncNow();

    expect(useStore.getState().sets[0].weight).toBe(245);
    expect(useSyncStore.getState().collisions).toHaveLength(1);
    expect(useSyncStore.getState().collisions[0]).toMatchObject({
      field: "weight",
      sheetValue: 235,
      appValue: 245,
    });
  });

  it("does not push at all when the pull fails", async () => {
    const api = fakeSheets({ readStatus: 500 });

    await useSyncStore.getState().syncNow();

    expect(api.calls).toEqual(["get"]);
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("keeps unread collisions across a later clean sync", async () => {
    useSyncStore.setState({
      collisions: [
        { tab: "daily", key: "2026-08-12", field: "calories", sheetValue: 2100, appValue: 2400 },
      ],
    });
    fakeSheets({ tabs: sheetWith(225) });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().collisions).toHaveLength(1);
    useSyncStore.getState().dismissCollisions();
    expect(useSyncStore.getState().collisions).toHaveLength(0);
  });
});

describe("device id", () => {
  beforeEach(() => {
    // `connectGoogle` refuses without one, and these tests connect. See the
    // note in "connecting a Google sheet" below.
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("survives a disconnect and reconnect, because it is this browser's", async () => {
    fakeSheets();
    await useSyncStore.getState().connectGoogle();
    const first = await loadDeviceId();
    expect(first).toBeTruthy();

    await useSyncStore.getState().disconnect();
    await useSyncStore.getState().connectGoogle();

    expect(useSyncStore.getState().config?.deviceId).toBe(first);
  });

  it("survives clearing all data, because a reset is not a new browser", async () => {
    fakeSheets();
    await useSyncStore.getState().connectGoogle();
    const id = await loadDeviceId();

    await useStore.getState().clearAllData();

    expect(await loadDeviceId()).toBe(id);
  });
});

describe("connecting a Google sheet", () => {
  beforeEach(() => {
    // Stubbed for the same reason google-transport.test.ts stubs it: without a
    // client id `connectGoogle` refuses before it ever names a sheet, so these
    // assertions were passing only on a machine that happens to have an
    // untracked .env.local, and failing anywhere else -- a worktree, a fresh
    // clone, CI. Whether the file exists is a property of the machine, not of
    // the behaviour under test.
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
    });
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("names the sheet after the person, when their coach's invite said who they are", async () => {
    // Every client's sheet is otherwise called the same thing, and the coach
    // picks between them in the Picker by name.
    localStorage.setItem(
      "trakt.pendingCoach",
      JSON.stringify({ name: "Marcus", clientName: "Bob" }),
    );
    const titles: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (!url.includes("values:")) {
        titles.push(String((body.properties as { title?: string })?.title ?? ""));
        return Promise.resolve(
          new Response(JSON.stringify({ spreadsheetId: "new_sheet", spreadsheetUrl: "u" })),
        );
      }
      return Promise.resolve(new Response("{}"));
    });

    await useSyncStore.getState().connectGoogle();

    expect(titles[0]).toBe("Trakt — Bob");
    expect(useSyncStore.getState().config?.spreadsheetId).toBe("new_sheet");
  });

  it("falls back to the date when nobody invited them", async () => {
    const titles: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (!url.includes("values:")) {
        titles.push(String((body.properties as { title?: string })?.title ?? ""));
        return Promise.resolve(
          new Response(JSON.stringify({ spreadsheetId: "new_sheet", spreadsheetUrl: "u" })),
        );
      }
      return Promise.resolve(new Response("{}"));
    });

    await useSyncStore.getState().connectGoogle();

    expect(titles[0]).toMatch(/^Trakt — \d{4}-\d{2}-\d{2}$/);
  });
});

describe("the plan tab", () => {
  const PLAN_TAB: CellValue[][] = [
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
    const api = fakeSheets();
    await useSyncStore.getState().syncNow();
    expect(api.pushed().plan).toBeDefined();
  });

  it("leaves a pending coach plan in the sheet instead of overwriting it", async () => {
    // The bug this prevents: the client's ordinary sync overwriting the plan
    // its coach just sent, before the client ever saw the prompt.
    await withBase();
    const api = fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    const tabs = api.pushed();
    expect(tabs.plan).toBeUndefined();
    expect(Object.keys(tabs).sort()).toEqual(["cardio", "daily", "sessions", "sets"]);
    // Nor may it be cleared, which would empty the tab just as surely.
    expect(api.cleared()).not.toContain("plan");
  });

  it("offers a coach plan the app has not absorbed", async () => {
    await withBase();
    fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    const pending = useSyncStore.getState().pendingCoachPlan;
    expect(pending?.issuedBy).toBe("coach");
    expect(pending?.phases[0]).toMatchObject({ name: "Cut", calories: 2200 });
  });

  it("opens the review itself, so a plan cannot sit unnoticed", async () => {
    // With the launch sync, this is how a plan announces itself: the person
    // opens the app and the review is in front of them.
    await withBase();
    fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().planReviewOpen).toBe(true);
  });

  it("does not reopen the review it was just dismissed from, until the next launch", async () => {
    // Dismissing is not deciding: the plan stays pending, the card and the tab
    // dot stay, and the next launch offers it again. What it must not do is
    // reappear over the app every time a sync runs.
    await withBase();
    fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });
    await useSyncStore.getState().syncNow();
    useSyncStore.getState().setPlanReviewOpen(false);

    fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });
    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().planReviewOpen).toBe(false);
    expect(useSyncStore.getState().pendingCoachPlan).toBeDefined();
  });

  it("does not re-offer a plan already accepted, and resumes publishing its own", async () => {
    // Re-reading the same tab on every sync has to be idempotent, or the app
    // would nag about the same plan forever.
    useStore.setState({ lastAcceptedPlanAt: "2026-09-14T10:00:00.000Z" });
    await withBase();
    const api = fakeSheets({ tabs: { [SHEET_TABS.plan]: PLAN_TAB } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
    expect(api.pushed().plan).toBeDefined();
  });

  it("does not offer a plan the app itself published", async () => {
    await withBase();
    const own = PLAN_TAB.map((r) => (r[1] === "issuedBy" ? ["meta", "issuedBy", "", "client"] : r));
    fakeSheets({ tabs: { [SHEET_TABS.plan]: own } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
  });

  it("publishes its own plan over a plan tab it cannot read", async () => {
    await withBase();
    const api = fakeSheets({ tabs: { [SHEET_TABS.plan]: [["Nonsense"], ["rows"]] } });

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().pendingCoachPlan).toBeUndefined();
    expect(api.pushed().plan).toBeDefined();
  });
});

afterEach(() => {
  setGoogleTokenSource(undefined);
  clearGoogleToken();
  vi.unstubAllGlobals();
});
