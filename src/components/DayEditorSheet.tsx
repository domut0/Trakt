import { parse } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore, type DailyLog } from "../lib/store";
import { useToast } from "./Toast";

/** Number field state while editing: the raw string the user typed, so a blank
 * stays blank instead of collapsing to 0. */
type Draft = Record<NumKey, string>;

type NumKey = "calories" | "protein" | "carbs" | "fat" | "steps" | "bodyweight";

const EMPTY_DRAFT: Draft = {
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  steps: "",
  bodyweight: "",
};

/** "" (or an unparseable entry) means NOT LOGGED, so it maps to undefined,
 * never to 0. A real typed 0 is kept: 0 steps is a meaningful value. */
function toValue(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function draftFrom(log: DailyLog | undefined): Draft {
  if (!log) return { ...EMPTY_DRAFT };
  const show = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    calories: show(log.calories),
    protein: show(log.protein),
    carbs: show(log.carbs),
    fat: show(log.fat),
    steps: show(log.steps),
    bodyweight: show(log.bodyweight),
  };
}

/** "2026-08-07" -> "Friday, August 7". Parsed as a LOCAL date so the header
 * never shows the neighbouring day. */
function headerLabel(date: string): string {
  const d = parse(date, "yyyy-MM-dd", new Date());
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * The shared editor for one day's numbers. Opened from the Today card and
 * (in later slices) from the calendar, hence the explicit `date` prop rather
 * than an assumption of today.
 */
export function DayEditorSheet({
  date,
  open,
  onClose,
}: {
  date: string;
  open: boolean;
  onClose: () => void;
}) {
  const unit = useStore((s) => s.unit);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const upsertDailyLog = useStore((s) => s.upsertDailyLog);
  const showToast = useToast();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isCheatDay, setIsCheatDay] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Re-prefill each time the sheet opens (or the day being edited changes).
  // Reading dailyLogs off the store rather than through the selector keeps
  // this from re-running mid-edit when an unrelated day is written.
  useEffect(() => {
    if (!open) {
      setDragY(0);
      setIsDragging(false);
      // Reset the keyboard lift too, or reopening the sheet paints one frame
      // with the padding left over from the last time a keyboard was up.
      setKeyboardOffset(0);
      return;
    }
    const existing = useStore.getState().dailyLogFor(date);
    setDraft(draftFrom(existing));
    setIsCheatDay(existing?.isCheatDay === true);
  }, [open, date]);

  // Adjust sheet bottom padding when soft keyboard appears to keep fields visible
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;
    const handleViewportChange = () => {
      const kH = window.innerHeight - vv.height;
      setKeyboardOffset(Math.max(0, kH));
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
  //
  // Escape is wired to onClose, not to save, so it behaves exactly like Cancel
  // and like a backdrop tap: the draft is dropped. A key that silently wrote
  // half-entered numbers into the log would be the worse of the two.
  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const existing = dailyLogs.find((l) => l.date === date);

  const save = () => {
    // The Undo snapshot. Two things about it are load-bearing:
    //
    // 1. It is read from the store HERE, before the upsert, not from the
    //    `dailyLogs` render value, so it cannot be a render behind.
    // 2. It is destructured into plain numbers immediately, so the Undo closure
    //    below holds VALUES rather than a record it would re-read at click
    //    time. A stale read there would write a wrong number into the log,
    //    which is worse than offering no Undo at all.
    const previousLog = useStore.getState().dailyLogFor(date);
    const prevCalories = previousLog?.calories;
    const prevProtein = previousLog?.protein;
    const prevCarbs = previousLog?.carbs;
    const prevFat = previousLog?.fat;
    const prevSteps = previousLog?.steps;
    const prevBodyweight = previousLog?.bodyweight;
    const prevIsCheatDay = previousLog?.isCheatDay;

    upsertDailyLog(date, {
      calories: toValue(draft.calories),
      protein: toValue(draft.protein),
      carbs: toValue(draft.carbs),
      fat: toValue(draft.fat),
      steps: toValue(draft.steps),
      bodyweight: toValue(draft.bodyweight),
      // Only ever store the interesting value. Writing `false` would keep an
      // otherwise-blank day alive as a record that means nothing.
      isCheatDay: isCheatDay ? true : undefined,
    });

    onClose();

    showToast({
      message: previousLog ? "Day updated" : "Day saved",
      actionLabel: "Undo",
      onAction: () => {
        // EVERY field of DailyLog other than `date` is listed, explicitly, and
        // every one is present as a key even when its value is undefined. That
        // is what makes undoing a CREATE work: `upsertDailyLog` merges by
        // spread, so a key holding undefined genuinely clears the field, the
        // merged record then satisfies `isDailyLogEmpty`, and the row is
        // DELETED rather than left as a zeroed shell that would still count as
        // a logged day everywhere days are counted.
        //
        // Omitting a key here instead of passing undefined would silently
        // preserve whatever the save wrote. If a field is ever added to
        // DailyLog it must be added here too.
        upsertDailyLog(date, {
          calories: prevCalories,
          protein: prevProtein,
          carbs: prevCarbs,
          fat: prevFat,
          steps: prevSteps,
          bodyweight: prevBodyweight,
          isCheatDay: prevIsCheatDay,
        });
      },
    });
  };

  const setField = (key: NumKey) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  /**
   * Where the bodyweight steppers start from when the field is blank.
   *
   * The most recently logged bodyweight, because that is the only number that
   * is ever nearly right: stepping is for nudging today's reading off
   * yesterday's, not for travelling to it from a constant. The literal fallback
   * is unit-aware only because a fixed 150 would mean "150 kg" for anyone on
   * kg, which is not a plausible starting point for anybody.
   */
  const seedBodyweight = (): number => {
    // Day keys are zero-padded yyyy-MM-dd, so lexicographic order IS
    // chronological order.
    let latest: DailyLog | undefined;
    for (const log of dailyLogs) {
      if (log.bodyweight === undefined) continue;
      if (!latest || log.date > latest.date) latest = log;
    }
    if (latest?.bodyweight !== undefined) return latest.bodyweight;
    return unit === "kg" ? 70 : 150;
  };

  const stepBodyweight = (dir: -1 | 1) => {
    const raw = draft.bodyweight.trim();
    const parsed = raw ? parseFloat(raw) : NaN;
    const base = Number.isNaN(parsed) ? seedBodyweight() : parsed;
    const next = Math.max(0, Math.round((base + dir * 0.5) * 10) / 10);
    setField("bodyweight")(String(next));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragStartY.current = e.clientY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = e.clientY - dragStartY.current;
    setDragY(Math.max(0, deltaY));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragY > 80) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
    setDragY(0);
  };

  const focusNextOrSave = (index: number) => {
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    } else {
      save();
    }
  };

  // `data-swipe-ignore`: this sheet is opened from the Today card, WeeklyView
  // and CalendarView, all of which render inside AppShell's <main>. React
  // portals bubble along the React tree, not the DOM tree, so touches in here
  // still reach <main>'s swipe-between-tabs handler, and a drag with any
  // horizontal component would navigate away mid-edit. AppShell's
  // shouldIgnoreSwipe resolves this attribute with a DOM `closest`, which
  // works from the portal's real position under document.body.
  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
      style={{ opacity: dragY > 0 ? Math.max(0, 1 - dragY / 300) : 1 }}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom), ${20 + keyboardOffset}px)`,
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* min-h-[44px], not the visual height of the 4px grabber: this is the
            drag-to-dismiss target, and py-3 alone gave it a 28px hit area. */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="flex min-h-[44px] w-full cursor-grab touch-none items-center active:cursor-grabbing"
          aria-label="Drag down to close sheet"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-5">
          <div className="t-caption text-muted-foreground">
            {existing ? "Edit day" : "Log day"}
          </div>
          <div className="mt-0.5 t-heading font-semibold tracking-tight">{headerLabel(date)}</div>

          {/* Grouped list of labelled numeric rows and cheat day switch */}
          <div className="mt-4 group-list bg-muted/40">
            {/* Calories */}
            <div className="group-row">
              <label htmlFor="day-field-calories" className="t-body font-medium text-foreground">
                Calories
              </label>
              <div className="flex min-w-0 items-baseline justify-end gap-1">
                <input
                  id="day-field-calories"
                  ref={(el) => {
                    inputRefs.current[0] = el;
                  }}
                  inputMode="numeric"
                  enterKeyHint="next"
                  aria-label="Calories"
                  value={draft.calories}
                  onChange={(e) => setField("calories")(e.target.value)}
                  onFocus={(e) => {
                    selectAllOnEntry(e.currentTarget);
                    e.currentTarget.scrollIntoView({ block: "nearest" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNextOrSave(0);
                    }
                  }}
                  placeholder="Not logged"
                  className="t-stat w-32 bg-transparent text-right outline-none placeholder:t-body placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Steps */}
            <div className="group-row group-row-sep">
              <label htmlFor="day-field-steps" className="t-body font-medium text-foreground">
                Steps
              </label>
              <div className="flex min-w-0 items-baseline justify-end gap-1">
                <input
                  id="day-field-steps"
                  ref={(el) => {
                    inputRefs.current[1] = el;
                  }}
                  inputMode="numeric"
                  enterKeyHint="next"
                  aria-label="Steps"
                  value={draft.steps}
                  onChange={(e) => setField("steps")(e.target.value)}
                  onFocus={(e) => {
                    selectAllOnEntry(e.currentTarget);
                    e.currentTarget.scrollIntoView({ block: "nearest" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNextOrSave(1);
                    }
                  }}
                  placeholder="Not logged"
                  className="t-stat w-32 bg-transparent text-right outline-none placeholder:t-body placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Protein */}
            <div className="group-row group-row-sep">
              <label htmlFor="day-field-protein" className="t-body font-medium text-foreground">
                Protein
              </label>
              <div className="flex min-w-0 items-baseline justify-end gap-1">
                <input
                  id="day-field-protein"
                  ref={(el) => {
                    inputRefs.current[2] = el;
                  }}
                  inputMode="decimal"
                  enterKeyHint="next"
                  aria-label="Protein"
                  value={draft.protein}
                  onChange={(e) => setField("protein")(e.target.value)}
                  onFocus={(e) => {
                    selectAllOnEntry(e.currentTarget);
                    e.currentTarget.scrollIntoView({ block: "nearest" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNextOrSave(2);
                    }
                  }}
                  placeholder="0"
                  className="t-stat w-24 bg-transparent text-right outline-none placeholder:t-body placeholder:text-muted-foreground"
                />
                <span className="t-label text-muted-foreground">g</span>
              </div>
            </div>

            {/* Carbs */}
            <div className="group-row group-row-sep">
              <label htmlFor="day-field-carbs" className="t-body font-medium text-foreground">
                Carbs
              </label>
              <div className="flex min-w-0 items-baseline justify-end gap-1">
                <input
                  id="day-field-carbs"
                  ref={(el) => {
                    inputRefs.current[3] = el;
                  }}
                  inputMode="decimal"
                  enterKeyHint="next"
                  aria-label="Carbs"
                  value={draft.carbs}
                  onChange={(e) => setField("carbs")(e.target.value)}
                  onFocus={(e) => {
                    selectAllOnEntry(e.currentTarget);
                    e.currentTarget.scrollIntoView({ block: "nearest" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNextOrSave(3);
                    }
                  }}
                  placeholder="0"
                  className="t-stat w-24 bg-transparent text-right outline-none placeholder:t-body placeholder:text-muted-foreground"
                />
                <span className="t-label text-muted-foreground">g</span>
              </div>
            </div>

            {/* Fat */}
            <div className="group-row group-row-sep">
              <label htmlFor="day-field-fat" className="t-body font-medium text-foreground">
                Fat
              </label>
              <div className="flex min-w-0 items-baseline justify-end gap-1">
                <input
                  id="day-field-fat"
                  ref={(el) => {
                    inputRefs.current[4] = el;
                  }}
                  inputMode="decimal"
                  enterKeyHint="next"
                  aria-label="Fat"
                  value={draft.fat}
                  onChange={(e) => setField("fat")(e.target.value)}
                  onFocus={(e) => {
                    selectAllOnEntry(e.currentTarget);
                    e.currentTarget.scrollIntoView({ block: "nearest" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      focusNextOrSave(4);
                    }
                  }}
                  placeholder="0"
                  className="t-stat w-24 bg-transparent text-right outline-none placeholder:t-body placeholder:text-muted-foreground"
                />
                <span className="t-label text-muted-foreground">g</span>
              </div>
            </div>

            {/* Bodyweight */}
            <div className="group-row group-row-sep">
              <label htmlFor="day-field-bodyweight" className="t-body font-medium text-foreground">
                Bodyweight
              </label>
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Decrease Bodyweight"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => stepBodyweight(-1)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface t-body font-semibold text-foreground active:scale-95"
                >
                  −
                </button>
                <div className="flex min-w-0 items-baseline justify-end gap-1">
                  <input
                    id="day-field-bodyweight"
                    ref={(el) => {
                      inputRefs.current[5] = el;
                    }}
                    inputMode="decimal"
                    enterKeyHint="done"
                    aria-label="Bodyweight"
                    value={draft.bodyweight}
                    onChange={(e) => setField("bodyweight")(e.target.value)}
                    onFocus={(e) => {
                      selectAllOnEntry(e.currentTarget);
                      e.currentTarget.scrollIntoView({ block: "nearest" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNextOrSave(5);
                      }
                    }}
                    placeholder="Not logged"
                    className="t-stat w-24 bg-transparent text-center outline-none placeholder:t-body placeholder:text-muted-foreground"
                  />
                  <span className="t-label text-muted-foreground">{unit}</span>
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Increase Bodyweight"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => stepBodyweight(1)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface t-body font-semibold text-foreground active:scale-95"
                >
                  +
                </button>
              </div>
            </div>

            {/* Cheat day */}
            <div className="group-row group-row-sep">
              <span className="t-body font-medium text-foreground">Cheat day</span>
              <button
                type="button"
                role="checkbox"
                aria-checked={isCheatDay}
                aria-label="Cheat day"
                onClick={() => setIsCheatDay(!isCheatDay)}
                className="flex h-6 w-6 items-center justify-center rounded-full t-label font-semibold transition-colors"
                style={{
                  backgroundColor: isCheatDay ? "var(--color-accent)" : "var(--color-border)",
                  color: isCheatDay ? "var(--color-accent-foreground)" : "transparent",
                }}
              >
                ✓
              </button>
            </div>
          </div>

          <p className="mt-3 t-label text-muted-foreground">
            Leave a field blank to record nothing for it. Clearing everything removes the day.
          </p>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-full py-3 t-body font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex-[2] min-h-[44px] rounded-full bg-accent py-3 t-body font-semibold text-accent-foreground"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Select a field's whole value as it is entered, so typing REPLACES the number
 * instead of appending to it. This is the single biggest friction win in the
 * editor: without it, correcting a 4-digit calorie entry means four backspaces
 * before the first useful keystroke.
 *
 * The synchronous `select()` is what works on desktop. iOS Safari runs its own
 * tap-to-place-caret AFTER the focus event and collapses that selection, so the
 * range is reapplied on the next frame. The activeElement check makes the
 * deferred half a no-op if the user has already moved on, and is also why this
 * needs no cleanup on unmount: a frame that lands after the sheet closes finds
 * a detached element and does nothing.
 *
 * These inputs carry no `type`, so they are text inputs and support
 * setSelectionRange; the try/catch is only insurance against that changing,
 * since `type="number"` would throw here.
 */
function selectAllOnEntry(el: HTMLInputElement) {
  el.select();
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // Selection unsupported for this input type; the sync select() stands.
    }
  });
}


