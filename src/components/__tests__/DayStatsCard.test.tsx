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
  targetsEnabled = true,
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
  targetsEnabled?: boolean;
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
    targetsEnabled,
    unit,
    targetProfiles: [profile],
    weekdayTargets: Array.from({ length: 7 }, () => PROFILE_ID),
    dailyLogs,
    foodEntries: [],
  });
}

const today = dayKey(new Date());

describe("DayStatsCard", () => {
  beforeEach(() => {
    seedStore({});
  });

  describe("goal mode remaining line", () => {
    it("renders 'left' on a cut day", () => {
      seedStore({
        goalMode: "cut",
        calories: 2500,
        dailyLogs: [{ date: today, calories: 1508 }],
      });

      render(<DayStatsCard date={today} />);
      expect(screen.getByText("992 calories left")).toBeInTheDocument();
    });

    it("renders 'left' on a maintain day", () => {
      seedStore({
        goalMode: "maintain",
        calories: 2500,
        dailyLogs: [{ date: today, calories: 1508 }],
      });

      render(<DayStatsCard date={today} />);
      expect(screen.getByText("992 calories left")).toBeInTheDocument();
    });

    it("renders 'to go' on a gain day", () => {
      seedStore({
        goalMode: "gain",
        calories: 2800,
        dailyLogs: [{ date: today, calories: 1808 }],
      });

      render(<DayStatsCard date={today} />);
      expect(screen.getByText("992 calories to go")).toBeInTheDocument();
    });
  });

  describe("unset targets", () => {
    it("renders no row for an unset target", () => {
      seedStore({
        calories: 2400,
        protein: 180,
        // carbs, fat, steps are intentionally unset
        dailyLogs: [
          { date: today, calories: 1500, protein: 120, carbs: 150, fat: 50, steps: 8000 },
        ],
      });

      render(<DayStatsCard date={today} />);

      expect(screen.getByText("Protein")).toBeInTheDocument();
      expect(screen.queryByText("Carbs")).not.toBeInTheDocument();
      expect(screen.queryByText("Fat")).not.toBeInTheDocument();
      expect(screen.queryByText("Steps")).not.toBeInTheDocument();
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
    it("renders targets alone with no logged values and no bodyweight row", () => {
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

      // No remaining line
      expect(screen.queryByText(/calories left/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/calories to go/i)).not.toBeInTheDocument();

      // No 'Not recorded'
      expect(screen.queryByText(/not recorded/i)).not.toBeInTheDocument();

      // No bodyweight row
      expect(screen.queryByText(/bodyweight/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/175\.5/)).not.toBeInTheDocument();
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
