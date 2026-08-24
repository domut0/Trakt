import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupBarcode,
  mapOffProduct,
  mapUsdaFood,
  searchOpenFoodFacts,
  searchUsda,
} from "../food-sources";

describe("food-sources", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("Open Food Facts mapping", () => {
    it("maps an OFF product payload correctly into MacroBasis shape", () => {
      const rawProduct = {
        code: "737628064502",
        product_name: "Peanut Butter",
        brands: "Justin's",
        url: "https://world.openfoodfacts.org/product/737628064502",
        serving_quantity: 32,
        serving_size: "2 tbsp (32 g)",
        product_quantity: 454,
        nutriments: {
          "energy-kcal_100g": 588,
          proteins_100g: 22,
          carbohydrates_100g: 22,
          fat_100g: 50,
        },
      };

      const mapped = mapOffProduct(rawProduct);
      expect(mapped).toEqual({
        name: "Peanut Butter",
        brand: "Justin's",
        barcode: "737628064502",
        sourceType: "off",
        sourceUrl: "https://world.openfoodfacts.org/product/737628064502",
        basisQuantity: 100,
        basisUnit: "g",
        servingWeight: 32,
        packageWeight: 454,
        isLiquid: undefined,
        calories: 588,
        protein: 22,
        carbs: 22,
        fat: 50,
      });
    });

    it("leaves absent nutrients undefined instead of defaulting to zero", () => {
      // An unknown nutrient is not zero: 0 means confirmed none (e.g. 0g fat in sugar),
      // whereas undefined signals that data was not reported in the remote source.
      const rawProduct = {
        product_name: "Specialty Powder",
        nutriments: {
          "energy-kcal_100g": 350,
          // protein, carbohydrates, and fat omitted entirely
        },
      };

      const mapped = mapOffProduct(rawProduct);
      expect(mapped.calories).toBe(350);
      expect(mapped.protein).toBeUndefined();
      expect(mapped.carbs).toBeUndefined();
      expect(mapped.fat).toBeUndefined();
    });

    it("preserves confirmed zero nutrients as zero", () => {
      const rawProduct = {
        product_name: "Pure Table Sugar",
        nutriments: {
          "energy-kcal_100g": 400,
          proteins_100g: 0,
          carbohydrates_100g: 100,
          fat_100g: 0,
        },
      };

      const mapped = mapOffProduct(rawProduct);
      expect(mapped.protein).toBe(0);
      expect(mapped.fat).toBe(0);
      expect(mapped.carbs).toBe(100);
    });

    it("parses serving weight from string when serving_quantity is absent", () => {
      // Label often contains weights inside parentheses like "1 bar (45 g)".
      const rawProduct = {
        product_name: "Granola Bar",
        serving_size: "1 bar (45 g)",
      };

      const mapped = mapOffProduct(rawProduct);
      expect(mapped.servingWeight).toBe(45);
    });

    it("detects liquid products from serving or packaging units", () => {
      const liquidProduct = {
        product_name: "Oat Milk",
        serving_size: "240 ml",
        serving_quantity_unit: "ml",
      };

      const mapped = mapOffProduct(liquidProduct);
      expect(mapped.isLiquid).toBe(true);
    });
  });

  describe("USDA FoodData Central mapping", () => {
    it("maps a USDA food payload correctly into MacroBasis shape", () => {
      const rawFood = {
        fdcId: 171688,
        description: "Egg, whole, raw, fresh",
        brandOwner: "Eggland's Best",
        gtinUpc: "012345678901",
        servingSize: 50,
        servingSizeUnit: "g",
        foodNutrients: [
          { nutrientNumber: "1008", nutrientName: "Energy", value: 143, unitName: "kcal" },
          { nutrientNumber: "1003", nutrientName: "Protein", value: 12.6, unitName: "g" },
          {
            nutrientNumber: "1005",
            nutrientName: "Carbohydrate, by difference",
            value: 0.72,
            unitName: "g",
          },
          {
            nutrientNumber: "1004",
            nutrientName: "Total lipid (fat)",
            value: 9.51,
            unitName: "g",
          },
        ],
      };

      const mapped = mapUsdaFood(rawFood);
      expect(mapped).toEqual({
        name: "Egg, whole, raw, fresh",
        brand: "Eggland's Best",
        barcode: "012345678901",
        sourceType: "usda",
        sourceUrl: "https://fdc.nal.usda.gov/food-details/171688/nutrients",
        basisQuantity: 100,
        basisUnit: "g",
        servingWeight: 50,
        packageWeight: undefined,
        isLiquid: undefined,
        calories: 143,
        protein: 12.6,
        carbs: 0.72,
        fat: 9.51,
      });
    });

    it("leaves absent nutrients undefined instead of defaulting to zero", () => {
      const rawFood = {
        description: "Olive Oil",
        foodNutrients: [
          { nutrientNumber: "1008", value: 884 },
          { nutrientNumber: "1004", value: 100 },
          // protein and carbs absent
        ],
      };

      const mapped = mapUsdaFood(rawFood);
      expect(mapped.calories).toBe(884);
      expect(mapped.fat).toBe(100);
      expect(mapped.protein).toBeUndefined();
      expect(mapped.carbs).toBeUndefined();
    });

    it("converts ounce serving size to grams for USDA foods", () => {
      const rawFood = {
        description: "Cheese",
        servingSize: 1,
        servingSizeUnit: "oz",
        foodNutrients: [],
      };

      const mapped = mapUsdaFood(rawFood);
      expect(mapped.servingWeight).toBeCloseTo(28.3, 1);
    });
  });

  describe("searchOpenFoodFacts", () => {
    it("returns mapped search results with identification header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          products: [
            {
              code: "111",
              product_name: "Oatmeal",
              nutriments: { "energy-kcal_100g": 389 },
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("oatmeal");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].source).toBe("off");
        expect(result.value[0].food.name).toBe("Oatmeal");
        expect(result.value[0].food.calories).toBe(389);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("world.openfoodfacts.org/api/v2/search"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-User-Agent": expect.stringContaining("AnythingButTheNotes"),
          }),
        }),
      );
    });

    it("short-circuits when offline without calling fetch", async () => {
      // Decision 8: Degrade honestly when offline. Do not waste battery or fail noisily.
      vi.stubGlobal("navigator", { onLine: false });
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("apple");
      expect(result).toEqual({
        ok: false,
        reason: "offline",
        message: "Device is offline",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns rateLimited when server responds with HTTP 429", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("snack");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("rateLimited");
      }
    });

    it("returns badResponse when payload is malformed rather than throwing", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("corrupted");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("badResponse");
      }
    });

    it("returns badResponse when response structure lacks products array", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: "shape" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("badResponse");
      }
    });

    it("returns empty result array for empty query string without fetching", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchOpenFoodFacts("   ");
      expect(result).toEqual({ ok: true, value: [] });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("propagates an abort signal to the fetch call", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ products: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const controller = new AbortController();
      await searchOpenFoodFacts("cereal", { signal: controller.signal });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("re-throws AbortError when signal is aborted during fetch", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
      vi.stubGlobal("fetch", mockFetch);

      const controller = new AbortController();
      controller.abort();

      await expect(searchOpenFoodFacts("cereal", { signal: controller.signal })).rejects.toThrow(
        "Aborted",
      );
    });
  });

  describe("lookupBarcode", () => {
    it("looks up product by barcode and returns mapped result", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 1,
          product: {
            code: "5000159461122",
            product_name: "Snickers Bar",
            brands: "Mars",
            nutriments: { "energy-kcal_100g": 484 },
          },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await lookupBarcode("5000159461122");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.source).toBe("off");
        expect(result.value?.food.name).toBe("Snickers Bar");
        expect(result.value?.food.barcode).toBe("5000159461122");
      }
    });

    it("returns ok with null value when barcode is not found (status 0)", async () => {
      // Decision 15: An unrecognised barcode opens the new-food form with code prefilled.
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 0,
          status_verbose: "product not found",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await lookupBarcode("9999999999999");
      expect(result).toEqual({ ok: true, value: null });
    });

    it("returns ok with null value when barcode lookup returns HTTP 404", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await lookupBarcode("0000000000000");
      expect(result).toEqual({ ok: true, value: null });
    });

    it("short-circuits when offline without calling fetch", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await lookupBarcode("123456");
      expect(result).toEqual({
        ok: false,
        reason: "offline",
        message: "Device is offline",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns rateLimited when HTTP 429 is encountered", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await lookupBarcode("123456");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("rateLimited");
      }
    });
  });

  describe("searchUsda", () => {
    it("returns noApiKey without calling fetch when API key is missing or undefined", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const resultUndefined = await searchUsda("banana", undefined);
      expect(resultUndefined).toEqual({
        ok: false,
        reason: "noApiKey",
        message: "USDA API key is required",
      });

      const resultEmpty = await searchUsda("banana", "   ");
      expect(resultEmpty).toEqual({
        ok: false,
        reason: "noApiKey",
        message: "USDA API key is required",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns mapped USDA results when API key is valid", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          foods: [
            {
              fdcId: 1102653,
              description: "Bananas, raw",
              foodNutrients: [
                { nutrientNumber: "1008", value: 89 },
                { nutrientNumber: "1003", value: 1.09 },
                { nutrientNumber: "1005", value: 22.8 },
                { nutrientNumber: "1004", value: 0.33 },
              ],
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchUsda("banana", "VALID_KEY");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].source).toBe("usda");
        expect(result.value[0].food.name).toBe("Bananas, raw");
        expect(result.value[0].food.calories).toBe(89);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.nal.usda.gov/fdc/v1/foods/search"),
        expect.anything(),
      );
    });

    it("returns noApiKey when USDA responds with HTTP 401 or 403", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchUsda("apple", "INVALID_KEY");
      expect(result).toEqual({
        ok: false,
        reason: "noApiKey",
        message: "Invalid USDA API key",
      });
    });

    it("short-circuits when offline without calling fetch", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchUsda("rice", "VALID_KEY");
      expect(result).toEqual({
        ok: false,
        reason: "offline",
        message: "Device is offline",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns rateLimited when USDA responds with HTTP 429", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchUsda("pasta", "VALID_KEY");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("rateLimited");
      }
    });

    it("returns badResponse when USDA response is malformed JSON", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await searchUsda("beef", "VALID_KEY");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("badResponse");
      }
    });

    it("propagates an abort signal to the USDA fetch call", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ foods: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const controller = new AbortController();
      await searchUsda("chicken", "VALID_KEY", { signal: controller.signal });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });
});
