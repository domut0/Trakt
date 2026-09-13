import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DayStatsCard } from "../DayStatsCard";
import { dayKey } from "../../lib/daily-log";
import { useStore } from "../../lib/store";
import type { TargetProfile } from "../../lib/store";
import type { GoalMode } from "../../lib/targets";

const PROFILE_ID = "tp_stats_test";

function seedStore({
  goalMode,
  calories,
  protein,
  carbs,
  fat,
  steps,
  dailyLogs = [],
  unit = "lbs",
}: {
  goalMode?: GoalMode;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
  dailyLogs?: {
    date: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    steps?: number;
    bodyweight?: number;
  }[];
  unit?: "lbs" | "kg";
}) {
  const profile: TargetProfile = {
    id: PROFILE_ID,
    name: "Test Profile",
    ...(goalMode !== undefined ? { goalMode } : {}),
    ...(calories !== undefined ? { calories } : {}),
    ...(protein !== undefined ? { protein } : {}),
    ...(carbs !== undefined ? { carbs } : {}),
    ...(fat !== undefined ? { fat } : {}),
    ...(steps !== undefined ? { steps } : {}),
  };

  useStore.setState({
    hydrated: true,
    unit,
    targetProfiles: [profile],
    weekdayTargets: Array.from({ length: 7 }, () => PROFILE_ID),
    dailyLogs,
  });
}

const today = dayKey(new Date());

describe("DayStatsCard", () => {
  beforeEach(() => {
    seedStore({});
  });

  describe("unset targets", () => {
    it("still renders the row, because the row is not about the target", () => {
      seedStore({
        calories: 2400,
        protein: 180,
        // carbs, fat, steps are intentionally unset
        dailyLogs: [
          { date: today, calories: 1500, protein: 120, carbs: 150, fat: 50, steps: 8000 },
        ],
      });

      render(<DayStatsCard date={today} />);

      // The card used to gate each row on whether a TARGET was set, so a day
      // with no targets configured showed a calorie figure and nothing else and
      // no amount of logging made protein appear. The six rows are fixed now;
      // a target only adds the "/ 180 g" beside the figure.
      for (const label of ["Bodyweight", "Calories", "Protein", "Carbs", "Fat", "Steps"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getByText("150")).toBeInTheDocument();
      expect(screen.getByText("50")).toBeInTheDocument();
      expect(screen.getByText("8,000")).toBeInTheDocument();
    });
  });

  describe("absent data representation", () => {
    it("renders 'Not recorded' and never '0' for an undefined macro", () => {
      seedStore({
        calories: 2500,
        protein: 180,
        fat: 65,
        carbs: 200,
        steps: 10000,
        dailyLogs: [{ date: today }],
      });

      render(<DayStatsCard date={today} />);

      const notRecorded = screen.getAllByText("Not recorded");
      expect(notRecorded.length).toBeGreaterThan(0);

      // Verify that no macro or calorie value shows 0
      expect(screen.queryByText(/^0\s*g/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0\s*\/ 180/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0\s*\/ 65/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0\s*\/ 200/i)).not.toBeInTheDocument();
    });
  });

  describe("future day mode", () => {
    it("prints targets as the figures, and leaves only bodyweight unrecorded", () => {
      const futureDate = "2099-01-01";
      seedStore({
        calories: 2500,
        protein: 180,
        fat: 65,
        carbs: 200,
        steps: 10000,
        dailyLogs: [
          {
            date: futureDate,
            calories: 1200,
            protein: 90,
            fat: 30,
            carbs: 100,
            steps: 5000,
            bodyweight: 175.5,
          },
        ],
      });

      render(<DayStatsCard date={futureDate} />);

      // Targets alone should be visible
      expect(screen.getByText(/2,500|2500/)).toBeInTheDocument();
      expect(screen.getByText(/180/)).toBeInTheDocument();
      expect(screen.getByText(/65/)).toBeInTheDocument();
      expect(screen.getByText(/200/)).toBeInTheDocument();
      expect(screen.getByText(/10,000|10000/)).toBeInTheDocument();

      // Logged values must not be visible
      expect(screen.queryByText(/1,200|1200/)).not.toBeInTheDocument();
      expect(screen.queryByText(/90/)).not.toBeInTheDocument();
      expect(screen.queryByText(/30/)).not.toBeInTheDocument();
      expect(screen.queryByText(/100/)).not.toBeInTheDocument();
      expect(screen.queryByText(/5,000|5000/)).not.toBeInTheDocument();

      // Bodyweight keeps its row like every other metric, but a future day
      // cannot have been weighed, so the row is empty rather than absent. It is
      // the ONLY "Not recorded" on a future day: the five rows above it print
      // their target as the figure, because printing a gap against a day that
      // has not happened reports a failure rather than a plan.
      expect(screen.getByText("Bodyweight")).toBeInTheDocument();
      expect(screen.queryByText(/175\.5/)).not.toBeInTheDocument();
      expect(screen.getAllByText(/not recorded/i)).toHaveLength(1);
    });
  });

  describe("bodyweight row", () => {
    it("renders bodyweight value only with unit on today/past day", () => {
      seedStore({
        calories: 2500,
        dailyLogs: [{ date: today, bodyweight: 182.4 }],
        unit: "lbs",
      });

      render(<DayStatsCard date={today} />);

      expect(screen.getByText("Bodyweight")).toBeInTheDocument();
      expect(screen.getByText(/182\.4/)).toBeInTheDocument();
      expect(screen.getByText("lbs")).toBeInTheDocument();
    });
  });
});
