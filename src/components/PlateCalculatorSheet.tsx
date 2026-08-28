import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
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

  // Above the guard below, deliberately: hooks cannot live after a return.
  useSheetDismiss(open, onClose);

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

  // `data-swipe-ignore`: this sheet is opened from /settings, which renders
  // inside AppShell's <main>. React portals bubble along the React tree rather
  // than the DOM tree, so touches in here still reach <main>'s
  // swipe-between-tabs handler, and a drag with any horizontal component would
  // navigate off Settings. The plate sleeve strip below is already spared by
  // shouldIgnoreSwipe's generic overflow-x check; the rest of the sheet was not.
  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-paper rule-heavy-t p-5 anim-sheet rounded-md"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom), ${20 + keyboardOffset}px)`,
        }}
      >
        <div className="mx-auto mb-3 h-1 w-10 bg-border" />

        <div className="flex items-center justify-between">
          <div>
            <div className="t-caption text-ink-2">Calculator</div>
            <h2 className="t-heading font-semibold tracking-tight">Plate loading</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plate calculator"
            className="flex h-11 w-11 items-center justify-center bg-wash text-ink-2 transition-transform active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* Input & Bar Selection */}
        <div className="mt-4 space-y-3">
          <div className="bg-wash p-3">
            <div className="t-caption text-ink-2">Target weight ({unit})</div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="decimal"
                enterKeyHint="done"
                aria-label="Target weight"
                value={targetStr}
                onChange={(e) => setTargetStr(e.target.value)}
                placeholder="0"
                className="t-stat w-full min-w-0 bg-transparent outline-none placeholder:t-stat placeholder:text-ink-2"
              />
              <span className="t-body font-medium text-ink-2">{unit}</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 t-caption text-ink-2">Bar weight</div>
            <div className="grid grid-cols-3 gap-2">
              {barOptions.map((w) => {
                const isSelected = barWeight === w;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setBarWeight(w)}
                    aria-label={`Select ${w} ${unit} bar`}
                    className={`flex min-h-[44px] h-11 items-center justify-center t-body font-medium transition-colors ${
                      isSelected
                        ? "bg-ink text-paper font-semibold"
                        : "bg-wash text-ink hover:bg-rule"
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
        <div className="mt-5 bg-wash p-4">
          <div className="flex items-center justify-between">
            <span className="t-caption text-ink-2">Plates per side</span>
            {stack.remainder > 0 && (
              <span className="px-2.5 py-0.5 border border-rule t-label font-medium text-ink-2">
                {stack.remainder} {unit} short
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-start gap-1.5 overflow-x-auto py-2">
            {/* Collar bar sleeve representation on left */}
            <div
              className="flex h-14 w-3 shrink-0 items-center justify-center bg-border"
              title="Barbell collar"
            />

            {expandedPlates.length === 0 ? (
              <div className="flex h-14 flex-1 items-center justify-center bg-wash px-3 t-body text-ink-2">
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
                    className="flex h-14 shrink-0 flex-col items-center justify-center bg-wash px-1.5 text-ink transition-all"
                  >
                    <span className="t-stat font-bold leading-none">{weight}</span>
                    <span className="mt-0.5 t-caption leading-none text-ink-2">{unit}</span>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-3 flex items-center justify-between t-body text-ink-2 pt-2.5">
            <span>
              Bar: {barWeight} {unit}
            </span>
            <span className="t-stat text-ink">
              Total: {stack.achieved} {unit}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 min-h-[44px] h-12 w-full bg-ink py-3 t-body font-semibold text-paper rounded-md"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
