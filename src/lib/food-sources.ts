import type { Food } from "./food";

/**
 * Remote food source clients for Open Food Facts and USDA FoodData Central.
 *
 * Decision 8 and 14: Local foods are always primary and offline. Remote sources
 * are queried only on deliberate tap, never automatically on background typing.
 *
 * This module is completely pure: no DOM, no React, no store state, and no retry
 * loops or backoff timers (failures are surfaced immediately to the user).
 */

export type RemoteSource = "off" | "usda";

export interface RemoteSearchResult {
  source: RemoteSource;
  food: Omit<Food, "id" | "createdAt">;
}

export type RemoteResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "offline" | "rateLimited" | "notFound" | "noApiKey" | "network" | "badResponse";
      message: string;
    };

/**
 * Open Food Facts whitelists X-User-Agent in CORS headers.
 * Browsers cannot set User-Agent directly, so OFF explicitly provides this
 * custom header for web apps to identify themselves under ODbL reuse terms.
 */
const OFF_USER_AGENT = "AnythingButTheNotes/1.0 (https://github.com/domut0/AnythingButTheNotesApp)";

/**
 * Parses a numeric value safely without treating missing or NaN values as 0.
 * A missing nutrient must remain undefined because zero denotes confirmed absence.
 */
function parseNumeric(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number.parseFloat(val);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Extracts a gram weight from strings such as "30 g", "1 bar (45g)", or "Cake (13 g)".
 * This avoids prompting the user when serving weight is already embedded in the label.
 */
function parseGramWeight(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const match = text.match(/(?:^|\(|\s|\/)(\d+(?:\.\d+)?)\s*g(?:ram(?:s)?)?(?:\)|\s|$)/i);
  if (match) {
    const val = Number.parseFloat(match[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return undefined;
}

/**
 * Extracts nutrients from Open Food Facts nutriments dictionary.
 * Searches prioritized keys and preserves undefined for absent entries.
 */
function extractOffNutrient(
  nutriments: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!nutriments || typeof nutriments !== "object") return undefined;
  for (const key of keys) {
    if (key in nutriments && nutriments[key] !== null && nutriments[key] !== undefined) {
      const parsed = parseNumeric(nutriments[key]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

/**
 * Maps an Open Food Facts product JSON object into our MacroBasis shape.
 * OFF basis is always per 100g, so basisQuantity is 100 and basisUnit is "g".
 */
export function mapOffProduct(product: Record<string, unknown>): Omit<Food, "id" | "createdAt"> {
  const name =
    (typeof product.product_name === "string" && product.product_name.trim()) ||
    (typeof product.product_name_en === "string" && product.product_name_en.trim()) ||
    (typeof product.generic_name === "string" && product.generic_name.trim()) ||
    (typeof product.generic_name_en === "string" && product.generic_name_en.trim()) ||
    "Unknown food";

  const brand =
    typeof product.brands === "string" && product.brands.trim() ? product.brands.trim() : undefined;

  const barcode =
    product.code != null && String(product.code).trim() !== ""
      ? String(product.code).trim()
      : undefined;

  // ODbL requires attribution: sourceUrl links directly to the Open Food Facts product page.
  const sourceUrl =
    typeof product.url === "string" && product.url.trim()
      ? product.url.trim()
      : barcode
        ? `https://world.openfoodfacts.org/product/${barcode}`
        : undefined;

  const nutriments =
    product.nutriments && typeof product.nutriments === "object"
      ? (product.nutriments as Record<string, unknown>)
      : undefined;

  const calories = extractOffNutrient(
    nutriments,
    "energy-kcal_100g",
    "energy-kcal_value",
    "energy-kcal",
  );
  const protein = extractOffNutrient(
    nutriments,
    "proteins_100g",
    "proteins_value",
    "proteins",
    "protein_100g",
  );
  const carbs = extractOffNutrient(
    nutriments,
    "carbohydrates_100g",
    "carbohydrates_value",
    "carbohydrates",
    "carbs_100g",
  );
  const fat = extractOffNutrient(nutriments, "fat_100g", "fat_value", "fat");

  let servingWeight: number | undefined;
  const servingQty = parseNumeric(product.serving_quantity);
  if (servingQty !== undefined && servingQty > 0 && product.serving_quantity_unit !== "ml") {
    servingWeight = servingQty;
  } else if (typeof product.serving_size === "string") {
    servingWeight = parseGramWeight(product.serving_size);
  }

  let packageWeight: number | undefined;
  const productQty = parseNumeric(product.product_quantity);
  if (productQty !== undefined && productQty > 0) {
    packageWeight = productQty;
  } else if (typeof product.quantity === "string") {
    packageWeight = parseGramWeight(product.quantity);
  }

  const isLiquid =
    product.serving_quantity_unit === "ml" ||
    (typeof product.serving_size === "string" && /\bml\b/i.test(product.serving_size)) ||
    (typeof product.quantity === "string" && /\bml\b/i.test(product.quantity))
      ? true
      : undefined;

  return {
    name,
    brand,
    barcode,
    sourceType: "off",
    sourceUrl,
    basisQuantity: 100,
    basisUnit: "g",
    servingWeight,
    packageWeight,
    isLiquid,
    calories,
    protein,
    carbs,
    fat,
  };
}

interface UsdaNutrientItem {
  nutrientNumber?: string | number;
  nutrientId?: number;
  nutrientName?: string;
  value?: number;
  amount?: number;
  unitName?: string;
}

/**
 * Extracts a nutrient amount from USDA foodNutrients array by nutrient number or regex.
 */
function extractUsdaNutrient(
  foodNutrients: unknown,
  matchers: { numbers?: (string | number)[]; nameRegex?: RegExp; excludeUnits?: string[] },
): number | undefined {
  if (!Array.isArray(foodNutrients)) return undefined;

  for (const item of foodNutrients) {
    if (!item || typeof item !== "object") continue;
    const n = item as UsdaNutrientItem;

    let isMatch = false;
    if (matchers.numbers && n.nutrientNumber != null) {
      const numStr = String(n.nutrientNumber);
      if (matchers.numbers.some((num) => String(num) === numStr)) {
        isMatch = true;
      }
    }
    if (!isMatch && matchers.nameRegex && typeof n.nutrientName === "string") {
      if (matchers.nameRegex.test(n.nutrientName)) {
        isMatch = true;
      }
    }

    if (isMatch) {
      if (
        matchers.excludeUnits &&
        typeof n.unitName === "string" &&
        matchers.excludeUnits.some((u) => u.toLowerCase() === n.unitName?.toLowerCase())
      ) {
        continue;
      }
      const val = parseNumeric(n.value !== undefined ? n.value : n.amount);
      if (val !== undefined) {
        return val;
      }
    }
  }

  return undefined;
}

/**
 * Maps a USDA FoodData Central search result food item into our MacroBasis shape.
 * USDA basis is per 100g, so basisQuantity is 100 and basisUnit is "g".
 */
export function mapUsdaFood(item: Record<string, unknown>): Omit<Food, "id" | "createdAt"> {
  const name =
    typeof item.description === "string" && item.description.trim()
      ? item.description.trim()
      : "Unknown food";

  const brand =
    (typeof item.brandOwner === "string" && item.brandOwner.trim()) ||
    (typeof item.brandName === "string" && item.brandName.trim()) ||
    undefined;

  const barcode =
    item.gtinUpc != null && String(item.gtinUpc).trim() !== ""
      ? String(item.gtinUpc).trim()
      : undefined;

  const fdcId = item.fdcId != null ? String(item.fdcId) : undefined;
  const sourceUrl = fdcId ? `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients` : undefined;

  const calories = extractUsdaNutrient(item.foodNutrients, {
    numbers: ["1008", "208", 1008, 208],
    nameRegex: /^energy$/i,
    excludeUnits: ["kj", "joule"],
  });
  const protein = extractUsdaNutrient(item.foodNutrients, {
    numbers: ["1003", "203", 1003, 203],
    nameRegex: /protein/i,
  });
  const carbs = extractUsdaNutrient(item.foodNutrients, {
    numbers: ["1005", "205", 1005, 205],
    nameRegex: /carbohydrate/i,
  });
  const fat = extractUsdaNutrient(item.foodNutrients, {
    numbers: ["1004", "204", 1004, 204],
    nameRegex: /total lipid|^fat$/i,
  });

  let servingWeight: number | undefined;
  const servingSize = parseNumeric(item.servingSize);
  const servingUnit = typeof item.servingSizeUnit === "string" ? item.servingSizeUnit.trim() : "";
  if (servingSize !== undefined && servingSize > 0) {
    if (!servingUnit || /^(?:g|grm|gram|grams|grms)$/i.test(servingUnit)) {
      servingWeight = servingSize;
    } else if (/^(?:oz|ounce|ounces)$/i.test(servingUnit)) {
      servingWeight = Math.round(servingSize * 28.3495 * 10) / 10;
    }
  } else if (typeof item.householdServingFullText === "string") {
    servingWeight = parseGramWeight(item.householdServingFullText);
  }

  let packageWeight: number | undefined;
  if (typeof item.packageWeight === "string") {
    packageWeight = parseGramWeight(item.packageWeight);
  }

  const isLiquid =
    /^(?:ml|mlt|fluid|fl)/i.test(servingUnit) ||
    (typeof item.householdServingFullText === "string" &&
      /\bml\b/i.test(item.householdServingFullText))
      ? true
      : undefined;

  return {
    name,
    brand,
    barcode,
    sourceType: "usda",
    sourceUrl,
    basisQuantity: 100,
    basisUnit: "g",
    servingWeight,
    packageWeight,
    isLiquid,
    calories,
    protein,
    carbs,
    fat,
  };
}

/**
 * Checks if an error represents an aborted fetch request.
 * DOMException in some environments (like jsdom) does not inherit from Error.
 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: unknown }).name === "AbortError";
}

/**
 * Checks if the browser or runtime environment is known to be offline.
 */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Searches Open Food Facts using the v2 search endpoint.
 * Requires custom X-User-Agent for identification under ODbL terms.
 */
export async function searchOpenFoodFacts(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<RemoteResult<RemoteSearchResult[]>> {
  if (isOffline()) {
    return { ok: false, reason: "offline", message: "Device is offline" };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: true, value: [] };
  }

  const url = new URL("https://world.openfoodfacts.org/api/v2/search");
  url.searchParams.set("search_terms", trimmed);
  url.searchParams.set(
    "fields",
    "code,product_name,product_name_en,generic_name,generic_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,quantity,url",
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "X-User-Agent": OFF_USER_AGENT,
        Accept: "application/json",
      },
      signal: opts?.signal,
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err;
    }
    return {
      ok: false,
      reason: "network",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 429) {
    return { ok: false, reason: "rateLimited", message: "Open Food Facts rate limit exceeded" };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "badResponse",
      message: `Open Food Facts request failed with HTTP ${res.status}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: "badResponse", message: "Malformed JSON from Open Food Facts" };
  }

  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { products?: unknown }).products)
  ) {
    return {
      ok: false,
      reason: "badResponse",
      message: "Open Food Facts response missing products array",
    };
  }

  const rawProducts = (data as { products: unknown[] }).products;
  const results: RemoteSearchResult[] = [];
  for (const p of rawProducts) {
    if (p && typeof p === "object") {
      results.push({
        source: "off",
        food: mapOffProduct(p as Record<string, unknown>),
      });
    }
  }

  return { ok: true, value: results };
}

/**
 * Looks up a single product by barcode on Open Food Facts.
 * Returns null value if the barcode is not found in the database.
 */
export async function lookupBarcode(
  barcode: string,
  opts?: { signal?: AbortSignal },
): Promise<RemoteResult<RemoteSearchResult | null>> {
  if (isOffline()) {
    return { ok: false, reason: "offline", message: "Device is offline" };
  }

  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) {
    return { ok: true, value: null };
  }

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-User-Agent": OFF_USER_AGENT,
        Accept: "application/json",
      },
      signal: opts?.signal,
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err;
    }
    return {
      ok: false,
      reason: "network",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 404) {
    return { ok: true, value: null };
  }
  if (res.status === 429) {
    return { ok: false, reason: "rateLimited", message: "Open Food Facts rate limit exceeded" };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "badResponse",
      message: `Open Food Facts request failed with HTTP ${res.status}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: "badResponse", message: "Malformed JSON from Open Food Facts" };
  }

  if (!data || typeof data !== "object") {
    return {
      ok: false,
      reason: "badResponse",
      message: "Invalid response from Open Food Facts",
    };
  }

  const typedData = data as { status?: unknown; product?: unknown };
  if (typedData.status === 0 || !typedData.product || typeof typedData.product !== "object") {
    return { ok: true, value: null };
  }

  const food = mapOffProduct(typedData.product as Record<string, unknown>);
  if (!food.barcode) {
    food.barcode = cleanBarcode;
  }

  return {
    ok: true,
    value: {
      source: "off",
      food,
    },
  };
}

/**
 * Searches USDA FoodData Central using registered API key.
 * Refuses DEMO_KEY implicitly by requiring an explicitly provided API key.
 */
export async function searchUsda(
  query: string,
  apiKey: string | undefined,
  opts?: { signal?: AbortSignal },
): Promise<RemoteResult<RemoteSearchResult[]>> {
  if (isOffline()) {
    return { ok: false, reason: "offline", message: "Device is offline" };
  }

  if (!apiKey || !apiKey.trim()) {
    return { ok: false, reason: "noApiKey", message: "USDA API key is required" };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: true, value: [] };
  }

  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey.trim());
  url.searchParams.set("query", trimmed);
  url.searchParams.set("pageSize", "25");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      signal: opts?.signal,
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err;
    }
    return {
      ok: false,
      reason: "network",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "noApiKey", message: "Invalid USDA API key" };
  }
  if (res.status === 429) {
    return { ok: false, reason: "rateLimited", message: "USDA API rate limit exceeded" };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "badResponse",
      message: `USDA request failed with HTTP ${res.status}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: "badResponse", message: "Malformed JSON from USDA" };
  }

  if (!data || typeof data !== "object" || !Array.isArray((data as { foods?: unknown }).foods)) {
    return {
      ok: false,
      reason: "badResponse",
      message: "USDA response missing foods array",
    };
  }

  const rawFoods = (data as { foods: unknown[] }).foods;
  const results: RemoteSearchResult[] = [];
  for (const item of rawFoods) {
    if (item && typeof item === "object") {
      results.push({
        source: "usda",
        food: mapUsdaFood(item as Record<string, unknown>),
      });
    }
  }

  return { ok: true, value: results };
}
