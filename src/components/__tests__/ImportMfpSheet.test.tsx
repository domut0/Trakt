import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixtureHtml from "../../lib/__tests__/fixtures/mfp-diary.html?raw";
import { type Food } from "../../lib/food";
import { useStore } from "../../lib/store";
import { ImportMfpSheet } from "../ImportMfpSheet";
import { ToastProvider } from "../Toast";

function renderSheet(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <ImportMfpSheet open onClose={onClose} />
    </ToastProvider>,
  );
  return { onClose };
}

const SPA_SHELL_HTML = `
<!DOCTYPE html>
<html>
  <head><title>MyFitnessPal</title></head>
  <body>
    <div id="__next">
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>
    </div>
  </body>
</html>
`;

describe("ImportMfpSheet", () => {
  beforeEach(() => {
    useStore.setState({
      foods: [],
      foodEntries: [],
      dailyLogs: [],
    });
  });

  it("surfaces the shell-guard error verbatim when un-rendered SPA shell is submitted", () => {
    renderSheet();

    const textarea = screen.getByLabelText("Diary HTML");
    fireEvent.change(textarea, { target: { value: SPA_SHELL_HTML } });

    const previewBtn = screen.getByRole("button", { name: "Preview diary" });
    fireEvent.click(previewBtn);

    // Verbatim error from parseMfpDiary explaining the issue and resolution
    expect(
      screen.getByText(
        "No food entries found. The HTML looks like the un-rendered MyFitnessPal single-page application shell. Please copy the rendered DOM from browser DevTools (Elements > Copy outerHTML) instead.",
      ),
    ).toBeInTheDocument();

    // No foods written
    expect(useStore.getState().foods).toHaveLength(0);
  });

  it("surfaces the shell-guard error when an SPA shell file is selected", async () => {
    renderSheet();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File([SPA_SHELL_HTML], "shell.html", { type: "text/html" });
    // Polyfill file.text for jsdom if needed
    if (!file.text) {
      file.text = async () => SPA_SHELL_HTML;
    }

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText(
          "No food entries found. The HTML looks like the un-rendered MyFitnessPal single-page application shell. Please copy the rendered DOM from browser DevTools (Elements > Copy outerHTML) instead.",
        ),
      ).toBeInTheDocument();
    });

    expect(useStore.getState().foods).toHaveLength(0);
  });

  it("displays the preview before any write to the database", () => {
    renderSheet();

    const textarea = screen.getByLabelText("Diary HTML");
    fireEvent.change(textarea, { target: { value: fixtureHtml } });

    const previewBtn = screen.getByRole("button", { name: "Preview diary" });
    fireEvent.click(previewBtn);

    // Preview metadata appears
    expect(screen.getByText("8 foods found")).toBeInTheDocument();
    expect(screen.getByText("All foods are new")).toBeInTheDocument();
    expect(screen.getByText("9 entries across 2 days")).toBeInTheDocument();
    expect(screen.getByText("Meals: Breakfast, Lunch, preworkout, Dinner")).toBeInTheDocument();

    // Top foods and derived bases appear
    expect(screen.getByText("Top foods by uses")).toBeInTheDocument();
    expect(screen.getByText("Clover Honey")).toBeInTheDocument();
    expect(screen.getByText("100 g · 305 kcal")).toBeInTheDocument();
    expect(screen.getByText("2 uses")).toBeInTheDocument();

    expect(screen.getByText("Puffed Snack")).toBeInTheDocument();
    expect(screen.getByText("1 Cake (13 g) · 35 kcal")).toBeInTheDocument();

    expect(screen.getByText("Hen Egg")).toBeInTheDocument();
    expect(screen.getByText("1 egg · 72 kcal")).toBeInTheDocument();

    expect(screen.getByText("Millhouse - Sandwich Loaf")).toBeInTheDocument();
    expect(screen.getByText("1 slices (64 g) · 80 kcal")).toBeInTheDocument();

    // Confirm button is ready
    expect(screen.getByRole("button", { name: "Import 8 foods" })).toBeInTheDocument();

    // Crucially: nothing has been written to the store yet
    expect(useStore.getState().foods).toHaveLength(0);
    expect(useStore.getState().foodEntries).toHaveLength(0);
  });

  it("confirming writes foods but creates zero foodEntries and touches no dailyLogs", () => {
    const { onClose } = renderSheet();

    const textarea = screen.getByLabelText("Diary HTML");
    fireEvent.change(textarea, { target: { value: fixtureHtml } });

    fireEvent.click(screen.getByRole("button", { name: "Preview diary" }));

    const confirmBtn = screen.getByRole("button", { name: "Import 8 foods" });
    fireEvent.click(confirmBtn);

    const { foods, foodEntries, dailyLogs } = useStore.getState();

    // All 8 distinct foods were imported
    expect(foods).toHaveLength(8);
    for (const food of foods) {
      expect(food.id).toMatch(/^f_[a-z0-9]+$/);
      expect(food.sourceType).toBe("mfp");
      expect(typeof food.createdAt).toBe("number");
    }

    const honey = foods.find((f) => f.name === "Clover Honey");
    expect(honey).toBeDefined();
    expect(honey?.basisQuantity).toBe(100);
    expect(honey?.basisUnit).toBe("g");
    expect(honey?.calories).toBe(305);

    const bread = foods.find((f) => f.name === "Sandwich Loaf");
    expect(bread?.brand).toBe("Millhouse");
    expect(bread?.servingLabel).toBe("slices");
    expect(bread?.servingWeight).toBe(64);

    // Decision 13: Protected hand-typed history by creating zero entries and touching no daily logs
    expect(foodEntries).toHaveLength(0);
    expect(dailyLogs).toHaveLength(0);

    // Sheet dismissed
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skips duplicates already present in the catalogue based on lowercased brand+name", () => {
    const existingHoney: Food = {
      id: "f_existing_honey",
      name: "Clover Honey",
      basisQuantity: 100,
      basisUnit: "g",
      calories: 305,
      sourceType: "user",
      createdAt: 1000,
    };

    const existingBread: Food = {
      id: "f_existing_bread",
      name: "Sandwich Loaf",
      brand: "millhouse", // Lowercase test
      basisQuantity: 1,
      basisUnit: "serving",
      sourceType: "user",
      createdAt: 1000,
    };

    useStore.setState({
      foods: [existingHoney, existingBread],
    });

    renderSheet();

    const textarea = screen.getByLabelText("Diary HTML");
    fireEvent.change(textarea, { target: { value: fixtureHtml } });

    fireEvent.click(screen.getByRole("button", { name: "Preview diary" }));

    // Preview indicates 2 skipped duplicates and 6 new additions
    expect(screen.getByText("8 foods found")).toBeInTheDocument();
    expect(screen.getByText("6 new to add, 2 existing to skip")).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Import 6 foods" });
    fireEvent.click(confirmBtn);

    const { foods } = useStore.getState();

    // 2 original + 6 new = 8 total
    expect(foods).toHaveLength(8);

    // Original records preserved unchanged
    const honey = foods.find((f) => f.name === "Clover Honey");
    expect(honey?.id).toBe("f_existing_honey");
    expect(honey?.sourceType).toBe("user");

    const bread = foods.find((f) => f.name === "Sandwich Loaf");
    expect(bread?.id).toBe("f_existing_bread");
    expect(bread?.sourceType).toBe("user");

    // Other foods added with "mfp" sourceType
    const egg = foods.find((f) => f.name === "Hen Egg");
    expect(egg?.id).toMatch(/^f_[a-z0-9]+$/);
    expect(egg?.sourceType).toBe("mfp");
  });

  it("disables import when all foods in the export are duplicates", () => {
    // Prepopulate all 8 foods
    const allExisting: Food[] = [
      {
        id: "f_1",
        name: "Clover Honey",
        basisQuantity: 100,
        basisUnit: "g",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_2",
        name: "Puffed Snack",
        basisQuantity: 1,
        basisUnit: "serving",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_3",
        name: "Hen Egg",
        basisQuantity: 1,
        basisUnit: "serving",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_4",
        name: "Berries, mixed, frozen",
        basisQuantity: 1,
        basisUnit: "serving",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_5",
        name: "Sandwich Loaf",
        brand: "Millhouse",
        basisQuantity: 1,
        basisUnit: "serving",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_6",
        name: "Starch Powder",
        basisQuantity: 100,
        basisUnit: "g",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_7",
        name: "Plain",
        brand: "Rolled Grain",
        basisQuantity: 1,
        basisUnit: "serving",
        sourceType: "user",
        createdAt: 1,
      },
      {
        id: "f_8",
        name: "Whole Milk",
        brand: "Dairy Co",
        basisQuantity: 100,
        basisUnit: "ml",
        sourceType: "user",
        createdAt: 1,
      },
    ];

    useStore.setState({ foods: allExisting });

    renderSheet();

    const textarea = screen.getByLabelText("Diary HTML");
    fireEvent.change(textarea, { target: { value: fixtureHtml } });

    fireEvent.click(screen.getByRole("button", { name: "Preview diary" }));

    expect(screen.getByText("0 new to add, 8 existing to skip")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "No new foods" });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    // Still 8 foods, no modifications
    expect(useStore.getState().foods).toHaveLength(8);
  });
});
