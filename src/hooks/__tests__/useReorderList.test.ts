import { describe, it, expect } from "vitest";
import {
  reorderItems,
  computeDropIndex,
  reorderFromGeometry,
  applyOrder,
  type ItemGeometry,
} from "../useReorderList";

describe("useReorderList geometry and ordering helpers", () => {
  describe("reorderItems", () => {
    it("moves an item down in the list", () => {
      const items = ["A", "B", "C", "D"];
      const result = reorderItems(items, 0, 2);
      expect(result).toEqual(["B", "C", "A", "D"]);
    });

    it("moves an item up in the list", () => {
      const items = ["A", "B", "C", "D"];
      const result = reorderItems(items, 3, 1);
      expect(result).toEqual(["A", "D", "B", "C"]);
    });

    it("returns copy when fromIndex equals toIndex", () => {
      const items = ["A", "B", "C"];
      const result = reorderItems(items, 1, 1);
      expect(result).toEqual(["A", "B", "C"]);
    });

    it("handles out of bounds indices safely", () => {
      const items = ["A", "B", "C"];
      expect(reorderItems(items, -1, 1)).toEqual(items);
      expect(reorderItems(items, 0, 5)).toEqual(["B", "C", "A"]);
    });
  });

  describe("computeDropIndex", () => {
    // 4 items, each 50px high from top: 0
    // Midpoints: item 0 -> 25, item 1 -> 75, item 2 -> 125, item 3 -> 175
    const geometries: ItemGeometry[] = [
      { top: 0, bottom: 50 },
      { top: 50, bottom: 100 },
      { top: 100, bottom: 150 },
      { top: 150, bottom: 200 },
    ];

    it("stays at fromIndex when pointer has not reached adjacent row midpoint", () => {
      expect(computeDropIndex(geometries, 0, 50)).toBe(0);
      expect(computeDropIndex(geometries, 2, 130)).toBe(2);
    });

    it("drops into slot 1 when dragging down from 0 past item 1 midpoint 75", () => {
      expect(computeDropIndex(geometries, 0, 80)).toBe(1);
    });

    it("drops into slot 2 when dragging down from 0 past item 2 midpoint 125", () => {
      expect(computeDropIndex(geometries, 0, 130)).toBe(2);
    });

    it("drops into last slot when dragging down past last row midpoint 175", () => {
      expect(computeDropIndex(geometries, 0, 190)).toBe(3);
      expect(computeDropIndex(geometries, 0, 300)).toBe(3);
    });

    it("drops into slot 0 when dragging up from 2 past item 0 midpoint 25", () => {
      expect(computeDropIndex(geometries, 2, 20)).toBe(0);
    });

    it("drops into slot 1 when dragging up from 3 past item 1 midpoint 75", () => {
      expect(computeDropIndex(geometries, 3, 70)).toBe(1);
    });

    it("handles empty geometries", () => {
      expect(computeDropIndex([], 0, 50)).toBe(0);
    });
  });

  describe("reorderFromGeometry", () => {
    it("computes drop index and returns reordered array", () => {
      const items = ["Bench", "Squat", "Deadlift"];
      const geometries: ItemGeometry[] = [
        { top: 0, bottom: 60 },
        { top: 60, bottom: 120 },
        { top: 120, bottom: 180 },
      ];
      // Drag Bench (0) down past Squat midpoint (90): pointer at 100 -> target index 1
      const result = reorderFromGeometry(items, 0, geometries, 100);
      expect(result).toEqual(["Squat", "Bench", "Deadlift"]);
    });
  });

  describe("applyOrder", () => {
    it("preserves original array when order is empty", () => {
      const items = [
        { exercise: { id: "a" } },
        { exercise: { id: "b" } },
        { exercise: { id: "c" } },
      ];
      expect(applyOrder(items, [])).toEqual(items);
    });

    it("reorders items according to user defined order", () => {
      const items = [
        { exercise: { id: "a" } },
        { exercise: { id: "b" } },
        { exercise: { id: "c" } },
      ];
      const order = ["c", "a", "b"];
      expect(applyOrder(items, order)).toEqual([
        { exercise: { id: "c" } },
        { exercise: { id: "a" } },
        { exercise: { id: "b" } },
      ]);
    });

    it("preserves natural relative position of new items added after reorder", () => {
      // Initial items: A, B, C reordered to C, A, B
      // Later, user adds D at the end: original sequence becomes A, B, C, D
      // D should remain after the reordered set, not disappear or jump randomly
      const items = [
        { exercise: { id: "a" } },
        { exercise: { id: "b" } },
        { exercise: { id: "c" } },
        { exercise: { id: "d" } },
      ];
      const order = ["c", "a", "b"];
      const reordered = applyOrder(items, order);
      expect(reordered.map((x) => x.exercise.id)).toEqual(["c", "a", "b", "d"]);
    });

    it("handles new items inserted in the middle preserved in their relative slots", () => {
      // If items has an unexpected new item between A and B
      const items = [
        { exercise: { id: "a" } },
        { exercise: { id: "x" } },
        { exercise: { id: "b" } },
      ];
      const order = ["b", "a"];
      // Reordered items in order take the slots of known items: slot 0 takes 'b', slot 2 takes 'a', slot 1 retains 'x'
      const reordered = applyOrder(items, order);
      expect(reordered.map((x) => x.exercise.id)).toEqual(["b", "x", "a"]);
    });

    it("safely ignores order IDs that no longer exist in items", () => {
      const items = [{ exercise: { id: "a" } }, { exercise: { id: "b" } }];
      const order = ["z", "b", "y", "a"];
      expect(applyOrder(items, order)).toEqual([
        { exercise: { id: "b" } },
        { exercise: { id: "a" } },
      ]);
    });
  });
});
