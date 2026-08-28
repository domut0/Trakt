/**
 * MyFitnessPal printable-diary HTML importer.
 *
 * Imports distinct foods from an MFP printable-diary export, ranked by
 * frequency of consumption (uses). Decision 13: historical entries are read to
 * establish ranking and macro bases, then discarded, so existing daily log
 * totals are never corrupted.
 */

export interface ImportedFood {
  brand?: string;
  name: string;
  uses: number;
  basisQuantity: number;
  basisUnit: "g" | "ml" | "serving";
  servingLabel?: string;
  servingWeight?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface ImportResult {
  foods: ImportedFood[];
  entriesSeen: number;
  daysSeen: number;
  mealNames: string[];
}

export type ParseMfpResult = { ok: true; result: ImportResult } | { ok: false; error: string };

/** Mass units normalised to grams per unit. */
const MASS_UNITS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  gramme: 1,
  grammes: 1,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
};

/** Volume units normalised to millilitres per unit. */
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  "fl oz": 29.5735,
  "fluid oz": 29.5735,
  "fluid ounce": 29.5735,
  "fluid ounces": 29.5735,
};

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

/** Decodes basic HTML entities found in diary exports. */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ");
}

/** Parses numeric macro cells, turning missing markers ("--") into undefined. */
function parseMacroCell(cellText: string | undefined): number | undefined {
  if (cellText === undefined) return undefined;
  const trimmed = cellText.trim();
  // MFP uses "--" for absent nutrients; absent values must remain undefined rather than 0
  if (trimmed === "" || trimmed === "--" || trimmed === "-") return undefined;
  const match = trimmed.replace(/,/g, "").match(/^[-+]?[\d.]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  return Number.isFinite(num) ? num : undefined;
}

/** Scales an optional nutrient value by a multiplier, preserving absence. */
function scaleMacro(value: number | undefined, factor: number): number | undefined {
  if (value === undefined) return undefined;
  return value * factor;
}

interface FoodAccumulator {
  brand?: string;
  name: string;
  uses: number;
  hasValidBasis: boolean;
  basisQuantity: number;
  basisUnit: "g" | "ml" | "serving";
  servingLabel?: string;
  servingWeight?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * Parses a MyFitnessPal printable diary HTML export into a catalogue of foods.
 */
export function parseMfpDiary(html: string): ParseMfpResult {
  // HTML comments must be stripped first to avoid phantom table tags swallowing real tables
  const strippedHtml = html.replace(/<!--[\s\S]*?-->/g, "");

  const mealNames: string[] = [];
  const seenDates = new Set<string>();
  const foodMap = new Map<string, FoodAccumulator>();
  let entriesSeen = 0;
  let tablesWithEntries = 0;

  const datePattern =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\b/gi;

  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(strippedHtml)) !== null) {
    const tableIndex = tableMatch.index;
    const tableContent = tableMatch[1];

    // Find the nearest preceding date matching "Mon D, YYYY"
    const precedingText = strippedHtml.slice(0, tableIndex);
    let lastDateMatch: RegExpExecArray | null = null;
    let dMatch: RegExpExecArray | null;
    const dateFinder = new RegExp(datePattern.source, "gi");
    while ((dMatch = dateFinder.exec(precedingText)) !== null) {
      lastDateMatch = dMatch;
    }

    let tableDate: string | undefined;
    if (lastDateMatch) {
      const monKey = lastDateMatch[1].toLowerCase();
      const monthNum = MONTH_MAP[monKey];
      if (monthNum) {
        const day = lastDateMatch[2].padStart(2, "0");
        const year = lastDateMatch[3];
        tableDate = `${year}-${monthNum}-${day}`;
      }
    }

    const tbodyRegex = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi;
    const tbodyBlocks: string[] = [];
    let tbodyMatch: RegExpExecArray | null;
    while ((tbodyMatch = tbodyRegex.exec(tableContent)) !== null) {
      tbodyBlocks.push(tbodyMatch[1]);
    }
    if (tbodyBlocks.length === 0) {
      tbodyBlocks.push(tableContent);
    }

    let tableHadEntries = false;

    for (const tbody of tbodyBlocks) {
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;

      while ((trMatch = trRegex.exec(tbody)) !== null) {
        const trContent = trMatch[1];
        const cellRegex = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
        const cells: string[] = [];
        let cellMatch: RegExpExecArray | null;

        while ((cellMatch = cellRegex.exec(trContent)) !== null) {
          const rawText = cellMatch[1].replace(/<[^>]+>/g, "");
          cells.push(decodeHtmlEntities(rawText).trim());
        }

        // Two cells indicate a meal heading (first cell carries meal name)
        if (cells.length === 2) {
          const mealName = cells[0].trim();
          if (mealName && !mealNames.includes(mealName)) {
            mealNames.push(mealName);
          }
          continue;
        }

        // Skip totals and table header rows
        if (cells.length === 0 || cells[0] === "TOTALS" || cells[0] === "FOODS") {
          continue;
        }

        // Food rows have at least 5 cells and begin with "Name, <quantity> <unit>"
        if (cells.length >= 5 && /,\s*[\d.]+\s+\S/.test(cells[0])) {
          const rawNameCell = cells[0];
          const splitMatch = rawNameCell.match(/^(.*),\s*([\d.]+)\s*(.*)$/);
          if (!splitMatch) continue;

          const rawFullName = splitMatch[1].trim();
          const quantity = parseFloat(splitMatch[2]);
          const rawUnit = splitMatch[3].trim();

          if (!Number.isFinite(quantity) || quantity <= 0) continue;

          // Split brand off name on the first " - " separator
          let brand: string | undefined;
          let name = rawFullName;
          const brandSepIndex = rawFullName.indexOf(" - ");
          if (brandSepIndex !== -1) {
            const possibleBrand = rawFullName.slice(0, brandSepIndex).trim();
            const possibleName = rawFullName.slice(brandSepIndex + 3).trim();
            if (possibleBrand.length > 0 && possibleName.length > 0) {
              brand = possibleBrand;
              name = possibleName;
            }
          }

          // Cell order: 0: name, 1: calories, 2: carbs, 3: fat, 4: protein
          const rawCalories = parseMacroCell(cells[1]);
          const rawCarbs = parseMacroCell(cells[2]);
          const rawFat = parseMacroCell(cells[3]);
          const rawProtein = parseMacroCell(cells[4]);

          let basisQuantity: number;
          let basisUnit: "g" | "ml" | "serving";
          let servingLabel: string | undefined;
          let servingWeight: number | undefined;
          let scaledCalories: number | undefined;
          let scaledProtein: number | undefined;
          let scaledCarbs: number | undefined;
          let scaledFat: number | undefined;

          let normalizedUnit = rawUnit.toLowerCase();
          // Unit normalisation prevents plurals like gram(s) from falling through to count units
          normalizedUnit = normalizedUnit.replace(/\(s\)$/i, "").trim();

          if (MASS_UNITS[normalizedUnit] !== undefined) {
            const massMultiplier = MASS_UNITS[normalizedUnit];
            const totalGrams = quantity * massMultiplier;
            const factor = 100 / totalGrams;
            basisQuantity = 100;
            basisUnit = "g";
            servingLabel = undefined;
            servingWeight = undefined;
            scaledCalories = scaleMacro(rawCalories, factor);
            scaledProtein = scaleMacro(rawProtein, factor);
            scaledCarbs = scaleMacro(rawCarbs, factor);
            scaledFat = scaleMacro(rawFat, factor);
          } else if (VOLUME_UNITS[normalizedUnit] !== undefined) {
            const volumeMultiplier = VOLUME_UNITS[normalizedUnit];
            const totalMl = quantity * volumeMultiplier;
            const factor = 100 / totalMl;
            basisQuantity = 100;
            basisUnit = "ml";
            servingLabel = undefined;
            servingWeight = undefined;
            scaledCalories = scaleMacro(rawCalories, factor);
            scaledProtein = scaleMacro(rawProtein, factor);
            scaledCarbs = scaleMacro(rawCarbs, factor);
            scaledFat = scaleMacro(rawFat, factor);
          } else {
            basisQuantity = 1;
            basisUnit = "serving";
            const factor = 1 / quantity;
            scaledCalories = scaleMacro(rawCalories, factor);
            scaledProtein = scaleMacro(rawProtein, factor);
            scaledCarbs = scaleMacro(rawCarbs, factor);
            scaledFat = scaleMacro(rawFat, factor);

            // Mine inline serving weights from parentheses or slash separators
            const parenMatch = rawUnit.match(
              /^(.*?)\s*\(([\d.]+)\s*(g|gram|grams|gramme|grammes|oz|ounce|ounces)(?:\s+ea\.?)?\)\s*$/i,
            );
            const slashMatch = rawUnit.match(
              /^(.*?)\s*\/\s*([\d.]+)\s*(g|gram|grams|gramme|grammes|oz|ounce|ounces)\s*$/i,
            );

            let label: string;
            if (parenMatch) {
              label = parenMatch[1].trim();
              const weightNum = parseFloat(parenMatch[2]);
              const weightUnit = parenMatch[3].toLowerCase();
              const multiplier = MASS_UNITS[weightUnit] ?? 1;
              servingWeight = weightNum * multiplier;
            } else if (slashMatch) {
              label = slashMatch[1].trim();
              const weightNum = parseFloat(slashMatch[2]);
              const weightUnit = slashMatch[3].toLowerCase();
              const multiplier = MASS_UNITS[weightUnit] ?? 1;
              servingWeight = weightNum * multiplier;
            } else {
              label = rawUnit.trim();
              servingWeight = undefined;
            }

            if (
              label === "" ||
              label.toLowerCase() === "serving" ||
              label.toLowerCase() === "servings"
            ) {
              servingLabel = undefined;
            } else {
              servingLabel = label;
            }
          }

          entriesSeen += 1;
          tableHadEntries = true;

          // Case-insensitive deduplication by brand + name
          const dedupeKey = `${(brand ?? "").toLowerCase()}::${name.toLowerCase()}`;
          const existing = foodMap.get(dedupeKey);
          const hasValidBasis = rawCalories !== undefined && quantity > 0;

          if (!existing) {
            foodMap.set(dedupeKey, {
              brand,
              name,
              uses: 1,
              hasValidBasis,
              basisQuantity,
              basisUnit,
              servingLabel,
              servingWeight,
              calories: scaledCalories,
              protein: scaledProtein,
              carbs: scaledCarbs,
              fat: scaledFat,
            });
          } else {
            existing.uses += 1;
            // First sample with calories and a positive quantity defines the basis
            if (!existing.hasValidBasis && hasValidBasis) {
              existing.basisQuantity = basisQuantity;
              existing.basisUnit = basisUnit;
              existing.servingLabel = servingLabel;
              existing.servingWeight = servingWeight;
              existing.calories = scaledCalories;
              existing.protein = scaledProtein;
              existing.carbs = scaledCarbs;
              existing.fat = scaledFat;
              existing.hasValidBasis = true;
            }
          }
        }
      }
    }

    if (tableHadEntries) {
      tablesWithEntries += 1;
      if (tableDate) {
        seenDates.add(tableDate);
      }
    }
  }

  // Guard against un-rendered SPA shells where no food rows are present
  if (entriesSeen === 0) {
    return {
      ok: false,
      error:
        "No food entries found. The HTML looks like the un-rendered MyFitnessPal single-page application shell. " +
        "Please copy the rendered DOM from browser DevTools (Elements > Copy outerHTML) instead.",
    };
  }

  const foods: ImportedFood[] = Array.from(foodMap.values()).map((item) => {
    const food: ImportedFood = {
      name: item.name,
      uses: item.uses,
      basisQuantity: item.basisQuantity,
      basisUnit: item.basisUnit,
    };
    if (item.brand !== undefined) food.brand = item.brand;
    if (item.servingLabel !== undefined) food.servingLabel = item.servingLabel;
    if (item.servingWeight !== undefined) food.servingWeight = item.servingWeight;
    if (item.calories !== undefined) food.calories = item.calories;
    if (item.protein !== undefined) food.protein = item.protein;
    if (item.carbs !== undefined) food.carbs = item.carbs;
    if (item.fat !== undefined) food.fat = item.fat;
    return food;
  });

  // Most frequently eaten foods appear first
  foods.sort((a, b) => b.uses - a.uses);

  const daysSeen = seenDates.size > 0 ? seenDates.size : tablesWithEntries;

  return {
    ok: true,
    result: {
      foods,
      entriesSeen,
      daysSeen,
      mealNames,
    },
  };
}
