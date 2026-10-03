import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoachProgressStore } from "../coach-progress-store";
import { pullTabs } from "../sync-client-google";
import { getAccessToken } from "../google-auth";
import { useStore } from "../store";
import type { CoachClient } from "../db";

vi.mock("../sync-client-google", () => ({ pullTabs: vi.fn() }));
vi.mock("../google-auth", () => ({ getAccessToken: vi.fn() }));
const clients: CoachClient[] = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  name: `Client ${i}`,
  kind: "google",
  spreadsheetId: `sheet${i}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useCoachProgressStore.setState({ entries: {}, refreshing: false });
  vi.mocked(getAccessToken).mockResolvedValue("token");
});

describe("read-only roster snapshots", () => {
  it("bounds reads to two at once and never changes the coach's main store or requests interactive auth in background", async () => {
    let running = 0;
    let max = 0;
    const own = useStore.getState();
    vi.mocked(pullTabs).mockImplementation(async () => {
      running++;
      max = Math.max(max, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return { ok: true, revision: 0, tabs: {} };
    });
    await useCoachProgressStore.getState().refresh(clients);
    expect(max).toBe(2);
    expect(pullTabs).toHaveBeenCalledTimes(5);
    expect(
      vi.mocked(pullTabs).mock.calls.every(([, options]) => options?.interactive === false),
    ).toBe(true);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(useStore.getState()).toBe(own);
    expect(
      Object.values(useCoachProgressStore.getState().entries).every(
        (entry) => entry.snapshot && entry.fetchedAt,
      ),
    ).toBe(true);
  });

  it("preserves a useful snapshot and its fetch time after a refresh failure", async () => {
    vi.mocked(pullTabs).mockResolvedValueOnce({ ok: true, revision: 0, tabs: {} });
    await useCoachProgressStore.getState().refresh([clients[0]]);
    const previous = useCoachProgressStore.getState().entries.c0;
    vi.mocked(pullTabs).mockResolvedValueOnce({ ok: false, error: "needs-consent" });
    await useCoachProgressStore.getState().refresh([clients[0]]);
    expect(useCoachProgressStore.getState().entries.c0).toMatchObject({
      snapshot: previous.snapshot,
      fetchedAt: previous.fetchedAt,
      error: "needs-consent",
      loading: false,
    });
  });

  it("authorizes once on a tap, then makes every client read cache-only", async () => {
    vi.mocked(pullTabs).mockResolvedValue({ ok: true, revision: 0, tabs: {} });
    await useCoachProgressStore.getState().refresh(clients, true);
    expect(getAccessToken).toHaveBeenCalledExactlyOnceWith({ interactive: true });
    expect(
      vi.mocked(pullTabs).mock.calls.every(([, options]) => options?.interactive === false),
    ).toBe(true);
  });

  it("does not read sheets after declined authorization", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new Error("needs-consent"));
    await useCoachProgressStore.getState().refresh(clients, true);
    expect(pullTabs).not.toHaveBeenCalled();
    expect(useCoachProgressStore.getState().entries.c0.error).toBe("needs-consent");
    expect(useCoachProgressStore.getState().refreshing).toBe(false);
  });

  it("does not restore a removed client's snapshot when a pending request returns", async () => {
    let finish!: (reply: Awaited<ReturnType<typeof pullTabs>>) => void;
    vi.mocked(pullTabs).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = useCoachProgressStore.getState().refresh([clients[0]]);
    useCoachProgressStore.getState().retainClients([]);
    finish({ ok: true, revision: 0, tabs: {} });
    await pending;
    expect(useCoachProgressStore.getState().entries.c0).toBeUndefined();
  });
});
