import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { type Food } from "../lib/food";
import { parseMfpDiary, type ImportedFood, type ImportResult } from "../lib/mfp-import";
import { useStore } from "../lib/store";
import { useToast } from "./Toast";

export interface ImportMfpSheetProps {
  open: boolean;
  onClose: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function dedupeKey(brand: string | undefined, name: string): string {
  return `${(brand ?? "").trim().toLowerCase()}::${name.trim().toLowerCase()}`;
}

function formatBasis(food: ImportedFood): string {
  let unitStr: string;
  if (food.basisUnit === "g") {
    unitStr = "100 g";
  } else if (food.basisUnit === "ml") {
    unitStr = "100 ml";
  } else {
    const label = food.servingLabel ?? "serving";
    const weightStr = food.servingWeight ? ` (${Math.round(food.servingWeight)} g)` : "";
    unitStr = `${food.basisQuantity} ${label}${weightStr}`;
  }

  if (food.calories !== undefined) {
    return `${unitStr} · ${Math.round(food.calories)} kcal`;
  }
  return unitStr;
}

/**
 * MyFitnessPal diary import sheet.
 *
 * Captures foods and macro bases from a printable diary report while strictly
 * preserving hand-typed history by creating catalogue foods only.
 */
export function ImportMfpSheet({ open, onClose }: ImportMfpSheetProps) {
  const foods = useStore((s) => s.foods);
  const upsertFood = useStore((s) => s.upsertFood);
  const showToast = useToast();

  const [rawHtml, setRawHtml] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setRawHtml("");
    setPreview(null);
    setError(null);
  }, [open]);

  useSheetDismiss(open, onClose);

  const handleParse = (html: string) => {
    const trimmed = html.trim();
    if (!trimmed) {
      setError("Paste your diary HTML or choose a file first.");
      setPreview(null);
      return;
    }

    const result = parseMfpDiary(trimmed);
    if (!result.ok) {
      // The parser's error explains the un-rendered SPA shell issue verbatim
      setError(result.error);
      setPreview(null);
      return;
    }

    setError(null);
    setPreview(result.result);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      setRawHtml(text);
      handleParse(text);
    } catch {
      setError("Could not read that file.");
      setPreview(null);
    }
  };

  // Identify duplicates against existing catalogue by brand and name
  const { newFoods, skippedCount } = useMemo(() => {
    if (!preview) return { newFoods: [], skippedCount: 0 };

    const existingKeys = new Set(foods.map((f) => dedupeKey(f.brand, f.name)));
    const toAdd: ImportedFood[] = [];
    let skipped = 0;

    for (const food of preview.foods) {
      if (existingKeys.has(dedupeKey(food.brand, food.name))) {
        skipped += 1;
      } else {
        toAdd.push(food);
      }
    }

    return { newFoods: toAdd, skippedCount: skipped };
  }, [preview, foods]);

  const handleConfirm = () => {
    if (!preview || newFoods.length === 0) return;

    const now = Date.now();
    // Decision 13: catalogue foods only, historical entries are intentionally discarded
    for (const item of newFoods) {
      const food: Food = {
        id: `f_${uid()}`,
        name: item.name,
        brand: item.brand,
        basisQuantity: item.basisQuantity,
        basisUnit: item.basisUnit,
        servingLabel: item.servingLabel,
        servingWeight: item.servingWeight,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        sourceType: "mfp",
        createdAt: now,
      };
      upsertFood(food);
    }

    const count = newFoods.length;
    showToast({
      message: count === 1 ? "Imported 1 food." : `Imported ${count} foods.`,
    });
    onClose();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col bg-paper rule-heavy-t p-5 anim-popup rounded-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <h2 className="t-heading font-semibold tracking-tight">Import MyFitnessPal diary</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label text-ink-2 hover:text-ink"
          >
            Done
          </button>
        </div>

        {!preview ? (
          <div className="flex flex-1 flex-col overflow-y-auto space-y-4">
            <div className="space-y-1 t-label text-ink-2">
              <p>Open printable diary in browser DevTools, Elements tab.</p>
              <p>Right-click the root &lt;html&gt; node and choose Copy outerHTML.</p>
            </div>

            <div className="space-y-3">
              <label className="flex min-h-[44px] cursor-pointer items-center justify-center bg-wash px-4 t-body font-medium text-ink hover:bg-wash">
                <span>Choose HTML file</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".html,text/html"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              <div className="space-y-2">
                <textarea
                  ref={textareaRef}
                  aria-label="Diary HTML"
                  value={rawHtml}
                  onChange={(e) => setRawHtml(e.target.value)}
                  placeholder="Or paste copied HTML here..."
                  rows={6}
                  className="w-full bg-wash p-3 t-body text-ink outline-none placeholder:text-ink-2 focus:ring-1 focus:ring-accent resize-none"
                />

                <button
                  type="button"
                  onClick={() => handleParse(rawHtml)}
                  disabled={!rawHtml.trim()}
                  className="flex min-h-[44px] w-full items-center justify-center bg-ink px-4 t-body font-semibold text-paper disabled:opacity-40 rounded-md"
                >
                  Preview diary
                </button>
              </div>
            </div>

            {error && <div className="p-3 t-label text-signal">{error}</div>}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto space-y-4 pr-1">
            <div className="group-list bg-wash">
              <div className="group-row flex-col justify-center p-3">
                <div className="t-body font-medium">
                  {preview.foods.length} {preview.foods.length === 1 ? "food" : "foods"} found
                </div>
                <div className="t-label text-ink-2">
                  {skippedCount > 0
                    ? `${newFoods.length} new to add, ${skippedCount} existing to skip`
                    : "All foods are new"}
                </div>
              </div>

              <div className="group-row group-row-sep flex-col justify-center p-3">
                <div className="t-body font-medium">
                  {preview.entriesSeen} {preview.entriesSeen === 1 ? "entry" : "entries"} across{" "}
                  {preview.daysSeen} {preview.daysSeen === 1 ? "day" : "days"}
                </div>
                <div className="t-label text-ink-2">Meals: {preview.mealNames.join(", ")}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="group-header t-caption">Top foods by uses</h3>
              <div className="group-list bg-wash">
                {preview.foods.slice(0, 10).map((food, idx) => (
                  <div
                    key={`${food.brand ?? ""}::${food.name}`}
                    className={`group-row items-center justify-between p-3 ${
                      idx > 0 ? "group-row-sep" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="truncate t-body font-medium">
                        {food.brand ? `${food.brand} - ${food.name}` : food.name}
                      </div>
                      <div className="t-label text-ink-2">{formatBasis(food)}</div>
                    </div>
                    <div className="shrink-0 t-label text-ink-2">
                      {food.uses} {food.uses === 1 ? "use" : "uses"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="flex min-h-[44px] flex-1 items-center justify-center bg-wash py-2 t-body font-medium text-ink-2"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={newFoods.length === 0}
                className="flex min-h-[44px] flex-1 items-center justify-center bg-ink py-2 t-body font-medium text-paper disabled:opacity-40 rounded-md"
              >
                {newFoods.length === 0
                  ? "No new foods"
                  : `Import ${newFoods.length} ${newFoods.length === 1 ? "food" : "foods"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
