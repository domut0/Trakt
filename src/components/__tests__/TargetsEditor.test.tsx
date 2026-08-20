import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TargetsEditor } from "../TargetsEditor";
import { useStore } from "../../lib/store";
import { directionFor, TARGET_FIELDS } from "../../lib/targets";

/**
 * The goal-mode control: one dial that resolves the direction of all five
 * fields, plus the plain-language line that says what it just did.
 *
 * The load-bearing claims here are that an absent `goalMode` DISPLAYS as
 * maintaining without being written to storage, and that the summary line is
 * generated from `directionFor` rather than transcribed from it, so the two can
 * never disagree.
 */

const PROFILE_ID = "tp_test";

function seedProfile(goalMode?: "cut" | "maintain" | "gain") {
  useStore.setState({
    hydrated: true,
    targetsEnabled: true,
    targetProfiles: [
      {
        id: PROFILE_ID,
        name: "Every day",
        calories: 2400,
        protein: 180,
        ...(goalMode ? { goalMode } : {}),
      },
    ],
    weekdayTargets: Array.from({ length: 7 }, () => PROFILE_ID),
  });
}

function storedProfile() {
  return useStore.getState().targetProfiles[0];
}

function goalGroup() {
  return screen.getByRole("radiogroup", { name: "Goal for Every day" });
}

function summaryText() {
  const described = goalGroup().getAttribute("aria-describedby");
  return document.getElementById(described ?? "")?.textContent ?? "";
}

beforeEach(() => {
  seedProfile();
});

describe("goal mode control", () => {
  it("offers exactly three options, not a picker per field", () => {
    render(<TargetsEditor />);
    const options = within(goalGroup()).getAllByRole("radio");
    expect(options.map((o) => o.textContent)).toEqual(["Cutting", "Maintaining", "Gaining"]);
  });

  it("shows a profile with no stored mode as maintaining, and writes nothing", () => {
    render(<TargetsEditor />);
    expect(screen.getByRole("radio", { name: "Maintaining" })).toBeChecked();
    // The read-time default must not become a stored value: every profile saved
    // before this control existed has to survive a visit to Settings unchanged.
    expect(storedProfile()).not.toHaveProperty("goalMode");
  });

  it("persists the mode only when the user picks one", () => {
    render(<TargetsEditor />);
    fireEvent.click(screen.getByRole("radio", { name: "Cutting" }));
    expect(storedProfile().goalMode).toBe("cut");
    expect(screen.getByRole("radio", { name: "Cutting" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Maintaining" })).not.toBeChecked();
  });

  it("moves the choice with the arrow keys, wrapping at the ends", () => {
    render(<TargetsEditor />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Maintaining" }), { key: "ArrowRight" });
    expect(storedProfile().goalMode).toBe("gain");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gaining" }), { key: "ArrowRight" });
    expect(storedProfile().goalMode).toBe("cut");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Cutting" }), { key: "ArrowLeft" });
    expect(storedProfile().goalMode).toBe("gain");
  });

  it("keeps exactly one tab stop, on the current choice", () => {
    seedProfile("cut");
    render(<TargetsEditor />);
    const stops = within(goalGroup())
      .getAllByRole("radio")
      .filter((o) => o.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("Cutting");
  });
});

describe("goal mode summary line", () => {
  it("changes with the mode", () => {
    render(<TargetsEditor />);
    const maintaining = summaryText();
    fireEvent.click(screen.getByRole("radio", { name: "Cutting" }));
    const cutting = summaryText();
    fireEvent.click(screen.getByRole("radio", { name: "Gaining" }));
    const gaining = summaryText();

    expect(new Set([maintaining, cutting, gaining]).size).toBe(3);
    expect(cutting).toBe(
      "Calories and fat are budgets. Protein and steps are goals to beat. Carbs sit near target.",
    );
    expect(maintaining).toBe(
      "Protein and steps are goals to beat. Calories, carbs and fat sit near target.",
    );
    expect(gaining).toBe(
      "Calories, protein and steps are goals to beat. Carbs and fat sit near target.",
    );
  });

  /**
   * The reason the line is generated rather than written out three times: if
   * someone changes a direction in targets.ts, this test fails here rather than
   * the screen quietly explaining a rule the app stopped applying.
   */
  it("names every field on the side targets.ts actually puts it", () => {
    const phrases = {
      ceiling: "budget",
      floor: "goal",
      band: "near target",
    } as const;

    for (const mode of ["cut", "maintain", "gain"] as const) {
      seedProfile(mode);
      const { unmount } = render(<TargetsEditor />);
      const line = summaryText();
      for (const field of TARGET_FIELDS) {
        const direction = directionFor(field, mode);
        // The clause a field's noun sits in is the one whose sentence contains
        // that noun; check the sentence carries the phrasing for its direction.
        const sentence = line
          .split(". ")
          .find((s) => new RegExp(`\\b${field === "carbs" ? "carbs" : field}\\b`, "i").test(s));
        expect(sentence, `${mode}/${field} is not mentioned at all`).toBeDefined();
        expect(sentence?.toLowerCase(), `${mode}/${field} should read as a ${direction}`).toContain(
          phrases[direction],
        );
      }
      unmount();
    }
  });
});
