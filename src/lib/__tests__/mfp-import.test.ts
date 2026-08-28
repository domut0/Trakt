import { describe, expect, it } from "vitest";
import fixtureHtml from "./fixtures/mfp-diary.html?raw";
import { parseMfpDiary } from "../mfp-import";

describe("parseMfpDiary", () => {
  it("parses the real diary fixture into foods, counts, and meals", () => {
    const parsed = parseMfpDiary(fixtureHtml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { result } = parsed;
    expect(result.entriesSeen).toBe(9);
    expect(result.daysSeen).toBe(2);
    expect(result.foods).toHaveLength(8);

    // Custom meal names and casing must be preserved verbatim
    expect(result.mealNames).toEqual(["Breakfast", "Lunch", "preworkout", "Dinner"]);

    const honey = result.foods.find((f) => f.name === "Clover Honey");
    expect(honey).toBeDefined();
    // Logged as "20 gram" and "40 grams", proving deduplication and unit normalisation
    expect(honey?.uses).toBe(2);
    expect(honey?.basisQuantity).toBe(100);
    expect(honey?.basisUnit).toBe("g");
    expect(honey?.calories).toBe(305);
    expect(honey?.carbs).toBe(80);
    expect(honey?.fat).toBe(0);
    expect(honey?.protein).toBe(0);

    const puffedSnack = result.foods.find((f) => f.name === "Puffed Snack");
    expect(puffedSnack).toBeDefined();
    expect(puffedSnack?.basisQuantity).toBe(1);
    expect(puffedSnack?.basisUnit).toBe("serving");
    expect(puffedSnack?.servingLabel).toBe("Cake");
    expect(puffedSnack?.servingWeight).toBe(13);
    expect(puffedSnack?.calories).toBeCloseTo(34.667, 2);

    const egg = result.foods.find((f) => f.name === "Hen Egg");
    expect(egg).toBeDefined();
    expect(egg?.basisQuantity).toBe(1);
    expect(egg?.basisUnit).toBe("serving");
    expect(egg?.servingLabel).toBe("egg");
    expect(egg?.calories).toBe(72);
    expect(egg?.fat).toBe(5);
    expect(egg?.protein).toBe(6);

    const berries = result.foods.find((f) => f.name === "Berries, mixed, frozen");
    expect(berries).toBeDefined();
    expect(berries?.basisQuantity).toBe(1);
    expect(berries?.basisUnit).toBe("serving");
    expect(berries?.servingLabel).toBe("cup");
    expect(berries?.calories).toBe(38);

    const sandwichLoaf = result.foods.find((f) => f.name === "Sandwich Loaf");
    expect(sandwichLoaf).toBeDefined();
    expect(sandwichLoaf?.brand).toBe("Millhouse");
    expect(sandwichLoaf?.basisQuantity).toBe(1);
    expect(sandwichLoaf?.basisUnit).toBe("serving");
    expect(sandwichLoaf?.servingLabel).toBe("slices");
    expect(sandwichLoaf?.servingWeight).toBe(64);
    expect(sandwichLoaf?.calories).toBe(80);

    const starch = result.foods.find((f) => f.name === "Starch Powder");
    expect(starch).toBeDefined();
    expect(starch?.basisQuantity).toBe(100);
    expect(starch?.basisUnit).toBe("g");
    expect(starch?.calories).toBeCloseTo(353.33, 1);

    const plain = result.foods.find((f) => f.name === "Plain");
    expect(plain).toBeDefined();
    expect(plain?.brand).toBe("Rolled Grain");
    expect(plain?.basisQuantity).toBe(1);
    expect(plain?.basisUnit).toBe("serving");
    expect(plain?.servingLabel).toBe("cup dry");
    expect(plain?.calories).toBe(420);

    const wholeMilk = result.foods.find((f) => f.name === "Whole Milk");
    expect(wholeMilk).toBeDefined();
    expect(wholeMilk?.brand).toBe("Dairy Co");
    expect(wholeMilk?.basisQuantity).toBe(100);
    expect(wholeMilk?.basisUnit).toBe("ml");
    expect(wholeMilk?.calories).toBeCloseTo(62.08, 2);
  });

  it("rejects an un-rendered SPA shell with no food rows", () => {
    const emptyShell = `
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
    const parsed = parseMfpDiary(emptyShell);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("No food entries found");
      expect(parsed.error).toContain("un-rendered MyFitnessPal");
    }
  });

  it("converts missing macro markers ('--') to undefined rather than zero", () => {
    const htmlWithMissing = `
      <div>
        <h2>Aug 21, 2026</h2>
        <table>
          <tbody>
            <tr>
              <td>Breakfast</td>
              <td></td>
            </tr>
            <tr>
              <th>Mystery Item, 1 serving</th>
              <th>--</th>
              <th>10g</th>
              <th>--</th>
              <th>5g</th>
              <th>0mg</th>
              <th>0mg</th>
              <th>--</th>
              <th>--</th>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const parsed = parseMfpDiary(htmlWithMissing);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const item = parsed.result.foods[0];
    expect(item.name).toBe("Mystery Item");
    expect(item.calories).toBeUndefined();
    expect(item.fat).toBeUndefined();
    expect(item.carbs).toBe(10);
    expect(item.protein).toBe(5);
  });

  it("extracts ounces and fluid ounces with conversion multipliers", () => {
    const customHtml = `
      <div>
        <h2>Sep 1, 2026</h2>
        <table>
          <tbody>
            <tr>
              <td>Lunch</td>
              <td></td>
            </tr>
            <tr>
              <th>Steak, 4 oz</th>
              <th>240</th>
              <th>0g</th>
              <th>16g</th>
              <th>24g</th>
              <th>70mg</th>
              <th>60mg</th>
              <th>0g</th>
              <th>0g</th>
            </tr>
            <tr>
              <th>Juice, 8 fl oz</th>
              <th>110</th>
              <th>26g</th>
              <th>0g</th>
              <th>1g</th>
              <th>0mg</th>
              <th>10mg</th>
              <th>22g</th>
              <th>0g</th>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const parsed = parseMfpDiary(customHtml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const steak = parsed.result.foods.find((f) => f.name === "Steak");
    expect(steak).toBeDefined();
    expect(steak?.basisQuantity).toBe(100);
    expect(steak?.basisUnit).toBe("g");
    // 4 oz = 113.398g; 240 kcal / 1.13398 = 211.64 kcal per 100g
    expect(steak?.calories).toBeCloseTo(211.64, 1);

    const juice = parsed.result.foods.find((f) => f.name === "Juice");
    expect(juice).toBeDefined();
    expect(juice?.basisQuantity).toBe(100);
    expect(juice?.basisUnit).toBe("ml");
    // 8 fl oz = 236.588ml; 110 kcal / 2.36588 = 46.49 kcal per 100ml
    expect(juice?.calories).toBeCloseTo(46.49, 1);
  });

  it("extracts inline weights in oz and container formats", () => {
    const inlineWeightHtml = `
      <div>
        <h2>Sep 2, 2026</h2>
        <table>
          <tbody>
            <tr>
              <td>Snack</td>
              <td></td>
            </tr>
            <tr>
              <th>Yogurt, 1 container (7 oz ea.)</th>
              <th>150</th>
              <th>15g</th>
              <th>2g</th>
              <th>18g</th>
              <th>10mg</th>
              <th>60mg</th>
              <th>12g</th>
              <th>0g</th>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const parsed = parseMfpDiary(inlineWeightHtml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const yogurt = parsed.result.foods.find((f) => f.name === "Yogurt");
    expect(yogurt).toBeDefined();
    expect(yogurt?.basisQuantity).toBe(1);
    expect(yogurt?.basisUnit).toBe("serving");
    expect(yogurt?.servingLabel).toBe("container");
    // 7 oz = 198.4465g
    expect(yogurt?.servingWeight).toBeCloseTo(198.45, 1);
    expect(yogurt?.calories).toBe(150);
  });

  it("ignores HTML comments mentioning table markup", () => {
    const commentHtml = `
      <!-- <table><tbody><tr><th>Fake Food, 100 g</th><th>999</th><th>0</th><th>0</th><th>0</th></tr></tbody></table> -->
      <div>
        <h2>Aug 21, 2026</h2>
        <table>
          <tbody>
            <tr>
              <td>Breakfast</td>
              <td></td>
            </tr>
            <tr>
              <th>Real Food, 100 g</th>
              <th>100</th>
              <th>10g</th>
              <th>0g</th>
              <th>5g</th>
              <th>0mg</th>
              <th>0mg</th>
              <th>0g</th>
              <th>0g</th>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const parsed = parseMfpDiary(commentHtml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.result.foods).toHaveLength(1);
    expect(parsed.result.foods[0].name).toBe("Real Food");
    expect(parsed.result.foods[0].calories).toBe(100);
  });
  it("never imports a TOTALS row as a food", () => {
    // Decision 6 derives a day's totals from its entries. Importing the row
    // MyFitnessPal already computed would double every day it appears on, and
    // the fixture carries one per day precisely so this stays covered.
    const parsed = parseMfpDiary(fixtureHtml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    for (const f of parsed.result.foods) {
      expect(f.name.toUpperCase()).not.toContain("TOTALS");
    }
    // Nine food rows across the two days, and the two TOTALS rows are not
    // among them. A count of 11 here would mean they had been swept in.
    expect(parsed.result.entriesSeen).toBe(9);
  });
});
