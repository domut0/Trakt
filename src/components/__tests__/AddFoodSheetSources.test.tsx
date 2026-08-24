import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../lib/store";
import { AddFoodSheet } from "../AddFoodSheet";

describe("AddFoodSheet remote sources and barcode flow", () => {
  const meal = { id: "m1", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 0 };
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockStopTrack: ReturnType<typeof vi.fn>;
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockStopTrack = vi.fn();
    mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: mockStopTrack }],
    });

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
      onLine: true,
    });

    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      value: 640,
      configurable: true,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      value: 480,
      configurable: true,
    });

    useStore.setState({
      foods: [],
      recipes: [],
      recipeIngredients: [],
      foodEntries: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("typing does NOT hit the network", () => {
    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const input = screen.getByLabelText("Search or enter food name");
    fireEvent.change(input, { target: { value: "Apple" } });
    fireEvent.change(input, { target: { value: "Banana" } });
    fireEvent.change(input, { target: { value: "Chicken" } });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tapping a remote chip is what triggers the fetch and nothing else does", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          products: [
            {
              product_name: "Gala Apple",
              brands: "Fresh Orchards",
              nutriments: {
                "energy-kcal_100g": 52,
                proteins_100g: 0.3,
                carbohydrates_100g: 14,
                fat_100g: 0.2,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const input = screen.getByLabelText("Search or enter food name");
    fireEvent.change(input, { target: { value: "Apple" } });

    // Typing did not query the network
    expect(fetchMock).not.toHaveBeenCalled();

    // Tapping the Open Food Facts chip triggers the fetch
    const offChip = screen.getByRole("button", { name: /Open Food Facts/i });
    fireEvent.click(offChip);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("https://world.openfoodfacts.org/api/v2/search");
    expect(fetchMock.mock.calls[0][0]).toContain("search_terms=Apple");

    // Results render with attribution
    expect(await screen.findByText("Gala Apple")).toBeInTheDocument();
    expect(screen.getByText("Fresh Orchards")).toBeInTheDocument();
    expect(screen.getByText("52 cal")).toBeInTheDocument();
    expect(screen.getByText(/Data from Open Food Facts \(ODbL\)\./)).toBeInTheDocument();
  });

  it("selecting a remote result caches it into local catalogue and logs it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          products: [
            {
              product_name: "Gala Apple",
              brands: "Fresh Orchards",
              nutriments: {
                "energy-kcal_100g": 52,
                proteins_100g: 0.3,
                carbohydrates_100g: 14,
                fat_100g: 0.2,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const input = screen.getByLabelText("Search or enter food name");
    fireEvent.change(input, { target: { value: "Apple" } });

    const offChip = screen.getByRole("button", { name: /Open Food Facts/i });
    fireEvent.click(offChip);

    const remoteFoodItem = await screen.findByText("Gala Apple");
    fireEvent.click(remoteFoodItem);

    // Food is now cached in the store
    const foods = useStore.getState().foods;
    expect(foods).toHaveLength(1);
    expect(foods[0].name).toBe("Gala Apple");
    expect(foods[0].brand).toBe("Fresh Orchards");
    expect(foods[0].sourceType).toBe("off");

    // Add to meal
    fireEvent.click(screen.getByRole("button", { name: "Add to Lunch" }));

    const entries = useStore.getState().foodEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Gala Apple");
    expect(entries[0].foodId).toBe(foods[0].id);
  });

  it("a barcode already in the catalogue resolves with zero fetch calls", async () => {
    useStore.setState({
      foods: [
        {
          id: "f_known",
          name: "Known Protein Bar",
          brand: "Quest",
          barcode: "012345678901",
          basisQuantity: 60,
          basisUnit: "g",
          calories: 200,
          protein: 21,
          carbs: 22,
          fat: 7,
          sourceType: "user",
          createdAt: 1,
        },
      ],
      foodEntries: [],
    });

    class MockBarcodeDetector {
      detect = vi.fn().mockResolvedValue([{ rawValue: "012345678901" }]);
    }
    vi.stubGlobal("BarcodeDetector", MockBarcodeDetector);

    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const scanButton = screen.getByLabelText("Scan barcode");
    fireEvent.click(scanButton);

    // Resolves to portion view for Known Protein Bar without network calls
    expect(await screen.findByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByText("Known Protein Bar")).toBeInTheDocument();
    expect(screen.getByText("Quest")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unknown barcode lands in quick entry with the code prefilled", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    class MockBarcodeDetector {
      detect = vi.fn().mockResolvedValue([{ rawValue: "999988887777" }]);
    }
    vi.stubGlobal("BarcodeDetector", MockBarcodeDetector);

    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const scanButton = screen.getByLabelText("Scan barcode");
    fireEvent.click(scanButton);

    // Lands in quick entry with the barcode prefilled
    const barcodeInput = await screen.findByLabelText("Barcode");
    expect(barcodeInput).toHaveValue("999988887777");

    // User fills in food details and logs it
    fireEvent.change(screen.getByLabelText("Food name"), { target: { value: "Unknown Snack" } });
    fireEvent.change(screen.getByLabelText("Calories"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Protein"), { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Add to Lunch" }));

    // The food is now stored in the catalogue with the barcode
    const foods = useStore.getState().foods;
    expect(foods).toHaveLength(1);
    expect(foods[0].name).toBe("Unknown Snack");
    expect(foods[0].barcode).toBe("999988887777");
    expect(foods[0].sourceType).toBe("user");

    const entries = useStore.getState().foodEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Unknown Snack");
    expect(entries[0].foodId).toBe(foods[0].id);
  });

  it("noApiKey surfaces a message pointing at Settings", async () => {
    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    const input = screen.getByLabelText("Search or enter food name");
    fireEvent.change(input, { target: { value: "Chicken" } });

    const usdaChip = screen.getByRole("button", { name: /^USDA/i });
    fireEvent.click(usdaChip);

    expect(await screen.findByText("USDA API key required")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Add your USDA API key in Settings under Data to search USDA FoodData Central\./i,
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
