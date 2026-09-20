import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncEngine } from "../SyncEngine";
import { ToastProvider } from "../Toast";
import { useStore } from "../../lib/store";
import { useSyncStore } from "../../lib/sync-store";
import type { SyncConfig } from "../../lib/sync-store";

/**
 * The launch sync. Everything else in SyncEngine reacts to something -- an
 * edit, a return from the background, the network coming back -- and a cold
 * start is none of those, so without this the app opened on stale data and a
 * coach's plan could sit unread in the sheet.
 */

const CONFIG = {
  kind: "google",
  spreadsheetId: "sheet-1",
  url: "",
  secret: "",
  deviceId: "d1",
  enabled: true,
} as unknown as SyncConfig;

function mount() {
  return render(
    <ToastProvider>
      <SyncEngine />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  useSyncStore.setState({ config: undefined });
});

describe("syncing on launch", () => {
  it("syncs once both stores have read their rows", async () => {
    const syncNow = vi.fn(() => Promise.resolve());
    useSyncStore.setState({ config: CONFIG, hydrate: () => Promise.resolve(), syncNow });
    useStore.setState({ hydrated: true });

    mount();
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
  });

  it("waits for the app's own data, so it cannot push an empty store", async () => {
    const syncNow = vi.fn(() => Promise.resolve());
    useSyncStore.setState({ config: CONFIG, hydrate: () => Promise.resolve(), syncNow });
    useStore.setState({ hydrated: false });

    mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(syncNow).not.toHaveBeenCalled();

    useStore.setState({ hydrated: true });
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
  });

  it("does nothing when no sheet is connected", async () => {
    const syncNow = vi.fn(() => Promise.resolve());
    useSyncStore.setState({ config: undefined, hydrate: () => Promise.resolve(), syncNow });
    useStore.setState({ hydrated: true });

    mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(syncNow).not.toHaveBeenCalled();
  });
});
