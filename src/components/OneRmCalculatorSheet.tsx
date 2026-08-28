import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { estimate1RM, percentageTable, RELIABLE_REP_LIMIT } from "../lib/onerm";
import { useStore } from "../lib/store";

/**
 * Bottom-sheet 1RM (one-rep max) calculator overlay. Provides weight/reps inputs,
 * Epley and Brzycki 1RM estimates with their average, and a percentage breakdown table.
 */
export function OneRmCalculatorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const unit = useStore((s) => s.unit);

  const [weightStr, setWeightStr] = useState("225");
  const [repsStr, setRepsStr] = useState("5");
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    if (open) {
      setWeightStr(unit === "kg" ? "100" : "225");
      setRepsStr("5");
    }
  }, [open, unit]);

  // Adjust sheet bottom padding when the soft keyboard appears so the estimate
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

  // An empty or half-typed field parses to NaN, and NaN renders literally as
  // "NaN". Both inputs collapse to 0, which the pure module treats as unusable
  // and reports as a 0 estimate.
  const parsedWeight = parseFloat(weightStr);
  const parsedReps = parseInt(repsStr, 10);
  const numWeight = Number.isFinite(parsedWeight) ? parsedWeight : 0;
  const numReps = Number.isFinite(parsedReps) ? parsedReps : 0;

  const estimate = estimate1RM(numWeight, numReps);
  const rows = percentageTable(estimate.average);

  // `data-swipe-ignore`: this sheet is opened from /settings, which renders
  // inside AppShell's <main>. React portals bubble along the React tree rather
  // than the DOM tree, so touches in here still reach <main>'s
  // swipe-between-tabs handler, and a drag with any horizontal component would
  // navigate off Settings while the percentage table is being read.
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
            <h2 className="t-heading font-semibold tracking-tight">1RM estimator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 1RM calculator"
            className="flex h-11 w-11 items-center justify-center bg-wash text-ink-2 transition-transform active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* Inputs */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-wash p-3">
            <div className="t-caption text-ink-2">Weight ({unit})</div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="decimal"
                enterKeyHint="next"
                aria-label="Weight"
                value={weightStr}
                onChange={(e) => setWeightStr(e.target.value)}
                placeholder="0"
                className="t-stat w-full min-w-0 bg-transparent outline-none placeholder:t-stat placeholder:text-ink-2"
              />
              <span className="t-label text-ink-2">{unit}</span>
            </div>
          </div>

          <div className="bg-wash p-3">
            <div className="t-caption text-ink-2">Reps</div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="numeric"
                enterKeyHint="done"
                aria-label="Reps"
                value={repsStr}
                onChange={(e) => setRepsStr(e.target.value)}
                placeholder="0"
                className="t-stat w-full min-w-0 bg-transparent outline-none placeholder:t-stat placeholder:text-ink-2"
              />
              <span className="t-label text-ink-2">reps</span>
            </div>
          </div>
        </div>

        {/* Estimates Card */}
        <div className="mt-4 bg-wash p-4">
          <div className="t-caption text-ink-2">Estimated 1RM</div>
          <div className="mt-1 flex items-baseline justify-between">
            <div>
              <span className="t-hero text-ink">{estimate.average}</span>
              <span className="ml-1.5 t-body font-medium text-ink-2">{unit} avg</span>
            </div>

            <div className="text-right t-label text-ink-2">
              <div>
                Epley: <span className="t-stat text-ink">{estimate.epley}</span> {unit}
              </div>
              <div>
                Brzycki: <span className="t-stat text-ink">{estimate.brzycki}</span> {unit}
              </div>
            </div>
          </div>

          {numReps > RELIABLE_REP_LIMIT && (
            <p className="mt-2.5 t-label leading-snug text-ink-2">
              Past {RELIABLE_REP_LIMIT} reps both formulas drift high. Treat this as a rough
              ceiling, not a number to load.
            </p>
          )}
        </div>

        {/* Percentages table */}
        <div className="mt-4">
          <div className="mb-2 t-caption text-ink-2">Percentages</div>

          <div className="max-h-[220px] overflow-y-auto bg-wash">
            <table className="w-full text-left t-body">
              <thead>
                <tr className="border-b border-rule t-caption text-ink-2">
                  <th className="px-3 py-2 font-medium">%</th>
                  <th className="px-3 py-2 font-medium">Reps</th>
                  <th className="px-3 py-2 text-right font-medium">Weight ({unit})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((row) => (
                  <tr key={row.percentage} className="hover:bg-wash transition-colors">
                    <td className="px-3 py-2.5 font-semibold text-ink">{row.percentage}%</td>
                    <td className="px-3 py-2.5 text-ink-2">{row.reps} reps</td>
                    <td className="px-3 py-2.5 text-right font-bold t-stat text-ink">
                      {row.weight} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
