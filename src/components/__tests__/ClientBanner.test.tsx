import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientBanner, freshness } from "../ClientBanner";
import { useCoachStore } from "../../lib/coach-store";
import type { CoachClient } from "../../lib/db";

const CLIENT: CoachClient = { id: "c_bob", name: "Bob", kind: "appsScript" };

function viewing(pulledAt: number) {
  useCoachStore.setState({ viewing: { client: CLIENT, pulledAt } });
}

beforeEach(() => {
  useCoachStore.setState({ viewing: undefined });
});

afterEach(() => {
  useCoachStore.setState({ viewing: undefined });
  vi.useRealTimers();
});

describe("ClientBanner", () => {
  it("renders nothing when no client is being viewed", () => {
    const { container } = render(<ClientBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names whose data is on screen", () => {
    viewing(Date.now());
    render(<ClientBanner />);
    expect(screen.getByText(/Bob’s Trakt/)).toBeInTheDocument();
  });

  it("says how stale the snapshot is, because decisions get made from it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00"));
    viewing(new Date("2026-09-14T09:00:00").getTime());
    render(<ClientBanner />);
    expect(screen.getByText(/3h ago/)).toBeInTheDocument();
  });

  it("offers the way out", () => {
    viewing(Date.now());
    render(<ClientBanner />);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });
});

describe("freshness", () => {
  const now = new Date("2026-09-14T12:00:00").getTime();
  const ago = (ms: number) => freshness(now - ms, now);

  it.each([
    ["just now", 30_000],
    ["1m ago", 60_000],
    ["59m ago", 59 * 60_000],
    ["1h ago", 60 * 60_000],
    ["23h ago", 23 * 3_600_000],
    ["1d ago", 24 * 3_600_000],
    ["3d ago", 3 * 24 * 3_600_000],
  ])("reads %s", (expected, elapsed) => {
    expect(ago(elapsed)).toBe(expected);
  });

  it("does not go negative on a clock that stepped backwards", () => {
    // NTP correcting mid-session is enough to make `now` earlier than the pull.
    expect(freshness(now + 5_000, now)).toBe("just now");
  });
});
