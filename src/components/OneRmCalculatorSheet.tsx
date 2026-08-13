import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
            <h2 className="text-[20px] font-semibold tracking-tight">1RM Estimator</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close 1RM calculator"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* Inputs */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Weight ({unit})
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="decimal"
                enterKeyHint="next"
                aria-label="Weight"
                value={weightStr}
                onChange={(e) => setWeightStr(e.target.value)}
                placeholder="0"
                className="tnum w-full min-w-0 bg-transparent text-[22px] font-semibold outline-none placeholder:text-muted-foreground"
              />
              <span className="text-[12px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          <div className="rounded-xl bg-muted p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reps</div>
            <div className="mt-1 flex items-baseline gap-1">
              <input
                inputMode="numeric"
                enterKeyHint="done"
                aria-label="Reps"
                value={repsStr}
                onChange={(e) => setRepsStr(e.target.value)}
                placeholder="0"
                className="tnum w-full min-w-0 bg-transparent text-[22px] font-semibold outline-none placeholder:text-muted-foreground"
              />
              <span className="text-[12px] text-muted-foreground">reps</span>
            </div>
          </div>
        </div>

        {/* Estimates Cards */}
        <div className="mt-4 rounded-2xl bg-muted/50 p-4 hairline-t">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Estimated 1RM
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <div>
              <span className="tnum text-[32px] font-extrabold tracking-tight text-accent">
                {estimate.average}
              </span>
              <span className="ml-1.5 text-[15px] font-medium text-muted-foreground">
                {unit} avg
              </span>
            </div>

            <div className="text-right text-[12px] text-muted-foreground">
              <div>
                Epley: <span className="tnum font-semibold text-foreground">{estimate.epley}</span>{" "}
                {unit}
              </div>
              <div>
                Brzycki:{" "}
                <span className="tnum font-semibold text-foreground">{estimate.brzycki}</span>{" "}
                {unit}
              </div>
            </div>
          </div>

          {numReps > RELIABLE_REP_LIMIT && (
            <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
              Past {RELIABLE_REP_LIMIT} reps both formulas drift high. Treat this as a rough
              ceiling, not a number to load.
            </p>
          )}
        </div>

        {/* Percentage Breakdown Table */}
        <div className="mt-4">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Percentage Breakdown
          </div>

          <div className="max-h-[220px] overflow-y-auto rounded-xl bg-muted/30 hairline-t">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Pct</th>
                  <th className="px-3 py-2 font-medium">Rep Target</th>
                  <th className="px-3 py-2 text-right font-medium">Weight ({unit})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => (
                  <tr key={row.percentage} className="hover:bg-muted/40 transition-colors">
                    <td className="px-3 py-2.5 font-semibold text-foreground">{row.percentage}%</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.reps} reps</td>
                    <td className="px-3 py-2.5 text-right font-bold tnum text-foreground">
                      {row.weight} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
