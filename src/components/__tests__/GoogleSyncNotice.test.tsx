import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleSyncNotice } from "../GoogleSyncNotice";
import { useSyncStore } from "../../lib/sync-store";
import type { SyncConfigMeta } from "../../lib/db";

vi.mock("../../lib/google-auth", () => ({ warmGoogleAuth: vi.fn() }));

const originalReauthorize = useSyncStore.getState().reauthorize;
const config = { kind: "google", enabled: true, spreadsheetId: "test" } as SyncConfigMeta;

describe("Google sync reconnect notice", () => {
  beforeEach(() => {
    useSyncStore.setState({ config, blockedReason: "needs-consent" });
  });
  afterEach(() => {
    useSyncStore.setState({
      config: undefined,
      blockedReason: undefined,
      reauthorize: originalReauthorize,
    });
  });
  it("offers reconnect without requesting sign-in until the user taps", async () => {
    const reconnect = vi.fn(async () => ({ ok: true as const }));
    useSyncStore.setState({ reauthorize: reconnect });
    render(<GoogleSyncNotice />);
    expect(screen.getByText("Google sync paused")).toBeInTheDocument();
    expect(reconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
  });
  it("shows a recoverable error when reconnect does not finish", async () => {
    useSyncStore.setState({
      reauthorize: async () => ({ ok: false, error: "Google sign-in was not completed." }),
    });
    render(<GoogleSyncNotice />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in was not completed.");
    expect(screen.getByRole("button", { name: "Reconnect Google" })).toBeEnabled();
  });
  it("does not show for disabled sync or an unrelated network failure", () => {
    useSyncStore.setState({ config: { ...config, enabled: false } });
    const { rerender, container } = render(<GoogleSyncNotice />);
    expect(container).toBeEmptyDOMElement();
    useSyncStore.setState({ config, blockedReason: "network" });
    rerender(<GoogleSyncNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
