import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DayActions } from "../DayActions";
import { dayKey } from "../../lib/daily-log";
import { useStore, type SplitSlot, type WorkoutSession } from "../../lib/store";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({ navigate: vi.fn(), history: { back: vi.fn() } }),
  };
});

/**
 * The actions that hang off a day.
 *
 * The rule worth pinning is when "Start <card> day" appears, because it is the
 * one that makes the button trustworthy: it offers the day's planned session
 * while that session is still ahead of you, and stops the moment it is behind
 * you. A button that kept offering a workout you had already done would be
 * inviting you to log it twice.
 */

const UPPER: SplitSlot = { id: "s_upper", name: "Upper", rotationOrder: 0, weekday: 4 };
const REST: SplitSlot = { id: "s_rest", name: "Rest", rotationOrder: 1, kind: "rest", weekday: 5 };

/** Thursday 20 August 2026, which is what UPPER's weekday 4 resolves to. */
const THURSDAY = "2026-08-20";
const FRIDAY = "2026-08-21";

function session(on: string, over: Partial<WorkoutSession> = {}): WorkoutSession {
  const at = new Date(`${on}T12:00:00`).getTime();
  return { id: `sess_${on}`, splitSlotId: UPPER.id, startedAt: at, ...over };
}

function setup(over: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    hydrated: true,
    slots: [UPPER, REST],
    plannedDays: [],
    planningMode: "week",
    sessions: [],
    sets: [],
    exercises: [],
    ...over,
  });
}

describe("DayActions", () => {
  beforeEach(() => setup());

  it("always offers to add an activity", () => {
    render(<DayActions date={THURSDAY} />);
    expect(screen.getByRole("button", { name: "Add activity" })).toBeTruthy();
  });

  it("names the planned card on a day that has one", () => {
    render(<DayActions date={THURSDAY} />);
    expect(screen.getByRole("button", { name: "Start Upper day" })).toBeTruthy();
  });

  it("offers nothing to start on a day the plan does not fill", () => {
    // Friday is the rest card, which is not a workout to start.
    render(<DayActions date={FRIDAY} />);
    expect(screen.queryByRole("button", { name: /^Start/ })).toBeNull();
  });

  it("stops offering once that day has been trained", () => {
    setup({ sessions: [session(THURSDAY)] });
    render(<DayActions date={THURSDAY} />);
    expect(screen.queryByRole("button", { name: /^Start/ })).toBeNull();
  });

  it("still offers it when the day's only session was cardio", () => {
    // A bike ride is not the planned Upper day, and having logged one is no
    // reason to stop offering to start the other.
    setup({ sessions: [session(THURSDAY, { kind: "cardio", splitSlotId: undefined })] });
    render(<DayActions date={THURSDAY} />);
    expect(screen.getByRole("button", { name: "Start Upper day" })).toBeTruthy();
  });

  it("is not fooled by a workout on a different day", () => {
    setup({ sessions: [session(FRIDAY)] });
    render(<DayActions date={THURSDAY} />);
    expect(screen.getByRole("button", { name: "Start Upper day" })).toBeTruthy();
  });

  it("prefers a pinned card over the weekday's", () => {
    setup({ plannedDays: [{ date: FRIDAY, splitSlotId: UPPER.id }] });
    render(<DayActions date={FRIDAY} />);
    expect(screen.getByRole("button", { name: "Start Upper day" })).toBeTruthy();
  });

  it("says nothing about a future day in rotation mode", () => {
    // A rotation advances when you train, so where it will be on a later date
    // depends on whether you train before then. Projecting it forward would be
    // confidently wrong, which is worse than saying nothing.
    setup({ planningMode: "rotation" });
    const future = dayKey(new Date(Date.now() + 7 * 86400000));
    render(<DayActions date={future} />);
    expect(screen.queryByRole("button", { name: /^Start/ })).toBeNull();
  });
});

describe("DayActions on a planned cardio day", () => {
  const RIDE: SplitSlot = {
    id: "s_ride",
    name: "Conditioning",
    rotationOrder: 2,
    kind: "cardio",
    weekday: 6,
  };
  /** Saturday 22 August 2026, which is what RIDE's weekday 6 resolves to. */
  const SATURDAY = "2026-08-22";

  beforeEach(() => setup({ slots: [UPPER, REST, RIDE] }));

  it("offers the cardio day by name", () => {
    render(<DayActions date={SATURDAY} />);
    expect(screen.getByRole("button", { name: "Start Conditioning day" })).toBeTruthy();
  });

  it("stops offering it once cardio has been logged that day", () => {
    setup({
      slots: [UPPER, REST, RIDE],
      sessions: [session(SATURDAY, { kind: "cardio", splitSlotId: undefined })],
    });
    render(<DayActions date={SATURDAY} />);
    expect(screen.queryByRole("button", { name: /^Start/ })).toBeNull();
  });

  it("keeps offering it when the day's only session was strength", () => {
    // The mirror of the rule on a workout day: a squat session is not the
    // conditioning the plan asked for.
    setup({ slots: [UPPER, REST, RIDE], sessions: [session(SATURDAY)] });
    render(<DayActions date={SATURDAY} />);
    expect(screen.getByRole("button", { name: "Start Conditioning day" })).toBeTruthy();
  });
});
