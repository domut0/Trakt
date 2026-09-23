import { describe, expect, it } from "vitest";
import { EXERCISE_GROUPS, seedExercises } from "../exercise-library";

describe("exercise library muscle groups", () => {
  it("covers every seed exercise with a muscle group entry", () => {
    // A lift added to the seed library must have an entry in EXERCISE_GROUPS so
    // it cannot silently fall out of the suggestion list.
    for (const exercise of seedExercises) {
      expect(
        EXERCISE_GROUPS[exercise.id],
        `Expected ${exercise.id} (${exercise.name}) to have a muscle group entry in EXERCISE_GROUPS`,
      ).toBeDefined();
    }
  });

  it("assigns machine variety exercises to their real trained group", () => {
    expect(EXERCISE_GROUPS["e_assisted_pullup"]).toBe("Back");
    expect(EXERCISE_GROUPS["e_assisted_dip"]).toBe("Triceps");
  });

  it("assigns the top un-commented seed exercises to real groups", () => {
    expect(EXERCISE_GROUPS["e_bench"]).toBe("Chest");
    expect(EXERCISE_GROUPS["e_squat"]).toBe("Quads");
    expect(EXERCISE_GROUPS["e_dead"]).toBe("Back");
    expect(EXERCISE_GROUPS["e_flap"]).toBe("Back");
    expect(EXERCISE_GROUPS["e_push"]).toBe("Triceps");
    expect(EXERCISE_GROUPS["e_curl"]).toBe("Biceps");
    expect(EXERCISE_GROUPS["e_row"]).toBe("Back");
  });
});
