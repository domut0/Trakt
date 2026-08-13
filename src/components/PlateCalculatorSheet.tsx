import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  computePlateStack,
  DEFAULT_BAR_KG,
  DEFAULT_BAR_LBS,
  DEFAULT_PLATES_KG,
  DEFAULT_PLATES_LBS,
} from "../lib/plates";
import { useStore } from "../lib/store";

/**
 * Bottom-sheet plate calculator overlay. Computes the greedy plate stack
 * needed per side of the barbell to load a target weight.
 */
export function PlateCalculatorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const unit = useStore((s) => s.unit);

  const defaultBar = unit === "kg" ? DEFAULT_BAR_KG : DEFAULT_BAR_LBS;
  const barOptions = unit === "kg" ? [20, 15, 10] : [45, 35, 15];

  const [targetStr, setTargetStr] = useState("135");
  const [barWeight, setBarWeight] = useState(defaultBar);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    if (open) {
      const initialBar = unit === "kg" ? DEFAULT_BAR_KG : DEFAULT_BAR_LBS;
      setBarWeight(initialBar);
      setTargetStr(unit === "kg" ? "60" : "135");
    }
  }, [open, unit]);

  // Adjust sheet bottom padding when the soft keyboard appears so the sleeve
  // and the Done button stay above it. Same pattern as LogSetSheet.
  useEffect(() => {
    if (!open) {
      setKeyboardOffset(0);
      return;
    }
    if (typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;
    const handleViewportChange = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height));
    };

    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    handleViewportChange();

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // An empty or half-typed field ("", "-", "abc") parses to NaN, and NaN renders
  // literally as "NaN". 0 falls below every bar weight, so the sheet shows the
  // bare bar instead.
  const parsedTarget = parseFloat(targetStr);
  const targetWeight = Number.isFinite(parsedTarget) ? parsedTarget : 0;
  const stack = computePlateStack(targetWeight, barWeight, undefined, unit);

  // Expand perSide pairs into individual plate weights for visual sleeve
  // rendering. Bounded because computePlateStack caps total plates per side, so
  // an absurd target cannot make this loop render millions of elements.
  const expandedPlates: number[] = [];
  for (const item of stack.perSide) {
    for (let i = 0; i < item.count; i++) {
      expandedPlates.push(item.weight);
    }
  }

  const maxPlateWeight = unit === "kg" ? DEFAULT_PLATES_KG[0] : DEFAULT_PLATES_LBS[0];

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom), ${20 + keyboardOffset}px)`,
        }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Calculator
            </div>
            <h2 className="text-[20px] font-semibold tracking-tight">Plate loading</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close plate calculator"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* Input & Bar Selection */}
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-muted p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Target weight ({unit})
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="decimal"
                enterKeyHint="done"
                aria-label="Target weight"
                value={targetStr}
                onChange={(e) => setTargetStr(e.target.value)}
                placeholder="0"
                className="tnum w-full min-w-0 bg-transparent text-[26px] font-semibold outline-none placeholder:text-muted-foreground"
              />
              <span className="text-[14px] font-medium text-muted-foreground">{unit}</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Bar weight
            </div>
            <div className="grid grid-cols-3 gap-2">
              {barOptions.map((w) => {
                const isSelected = barWeight === w;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setBarWeight(w)}
                    aria-label={`Select ${w} ${unit} bar`}
                    className={`flex h-11 items-center justify-center rounded-xl text-[14px] font-medium transition-colors ${
                      isSelected
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "bg-muted text-foreground hover:bg-border"
                    }`}
                  >
                    {w} {unit}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Visual Sleeve & Per Side Loading */}
        <div className="mt-5 rounded-2xl bg-muted/50 p-4 hairline-t">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Plates per side
            </span>
            {stack.remainder > 0 && (
              <span className="rounded-full bg-border px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                {stack.remainder} {unit} short
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-start gap-1.5 overflow-x-auto py-2">
            {/* Collar bar sleeve representation on left */}
            <div
              className="flex h-14 w-3 shrink-0 items-center justify-center rounded-l-md bg-border"
              title="Barbell collar"
            />

            {expandedPlates.length === 0 ? (
              <div className="flex h-14 flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 text-[13px] text-muted-foreground">
                Bar only (no plates)
              </div>
            ) : (
              expandedPlates.map((weight, idx) => {
                // Width scaled proportionally to plate weight
                const ratio = weight / maxPlateWeight;
                const minWidth = Math.max(34, Math.round(30 + ratio * 32));

                return (
                  <div
                    key={`${weight}-${idx}`}
                    style={{ minWidth: `${minWidth}px` }}
                    className="flex h-14 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-muted px-1.5 text-foreground shadow-sm transition-all"
                  >
                    <span className="tnum text-[15px] font-bold leading-none">{weight}</span>
                    <span className="mt-0.5 text-[9px] uppercase leading-none text-muted-foreground">
                      {unit}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground hairline-t pt-2.5">
            <span>
              Bar: {barWeight} {unit}
            </span>
            <span className="tnum font-semibold text-foreground">
              Total: {stack.achieved} {unit}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 h-12 w-full rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
