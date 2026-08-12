import { parse } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

  if (!open || typeof document === "undefined") return null;

  const existing = dailyLogs.find((l) => l.date === date);

  const save = () => {
    const previousLog = dailyLogs.find((l) => l.date === date);
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
      message: "Day saved",
      actionLabel: "Undo",
      onAction: () => {
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

  const stepBodyweight = (dir: -1 | 1) => {
    const raw = draft.bodyweight.trim();
    const current = raw ? parseFloat(raw) : 150;
    const base = Number.isNaN(current) ? 150 : current;
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

  return createPortal(
    <div
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
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="w-full cursor-grab touch-none py-3 active:cursor-grabbing"
          aria-label="Drag down to close sheet"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {existing ? "Edit day" : "Log day"}
          </div>
          <div className="mt-0.5 text-[22px] font-semibold tracking-tight">{headerLabel(date)}</div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <NumField
              label="Calories"
              value={draft.calories}
              onChange={setField("calories")}
              placeholder="Not logged"
              inputMode="numeric"
              enterKeyHint="next"
              onEnter={() => focusNextOrSave(0)}
              inputRef={(el) => {
                inputRefs.current[0] = el;
              }}
            />
            <NumField
              label="Steps"
              value={draft.steps}
              onChange={setField("steps")}
              placeholder="Not logged"
              inputMode="numeric"
              enterKeyHint="next"
              onEnter={() => focusNextOrSave(1)}
              inputRef={(el) => {
                inputRefs.current[1] = el;
              }}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <NumField
              label="Protein"
              suffix="g"
              value={draft.protein}
              onChange={setField("protein")}
              placeholder="0"
              inputMode="decimal"
              enterKeyHint="next"
              onEnter={() => focusNextOrSave(2)}
              inputRef={(el) => {
                inputRefs.current[2] = el;
              }}
            />
            <NumField
              label="Carbs"
              suffix="g"
              value={draft.carbs}
              onChange={setField("carbs")}
              placeholder="0"
              inputMode="decimal"
              enterKeyHint="next"
              onEnter={() => focusNextOrSave(3)}
              inputRef={(el) => {
                inputRefs.current[3] = el;
              }}
            />
            <NumField
              label="Fat"
              suffix="g"
              value={draft.fat}
              onChange={setField("fat")}
              placeholder="0"
              inputMode="decimal"
              enterKeyHint="next"
              onEnter={() => focusNextOrSave(4)}
              inputRef={(el) => {
                inputRefs.current[4] = el;
              }}
            />
          </div>

          <div className="mt-3">
            <NumField
              label="Bodyweight"
              suffix={unit}
              value={draft.bodyweight}
              onChange={setField("bodyweight")}
              placeholder="Not logged"
              inputMode="decimal"
              enterKeyHint="done"
              onEnter={() => focusNextOrSave(5)}
              onStep={stepBodyweight}
              inputRef={(el) => {
                inputRefs.current[5] = el;
              }}
            />
          </div>

          <button
            type="button"
            role="checkbox"
            aria-checked={isCheatDay}
            onClick={() => setIsCheatDay(!isCheatDay)}
            className="mt-3 flex min-h-[44px] w-full items-center justify-between rounded-xl bg-muted p-3 text-left"
          >
            <span className="text-[15px]">Cheat day</span>
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold"
              style={{
                backgroundColor: isCheatDay ? "var(--color-accent)" : "var(--color-border)",
                color: isCheatDay ? "var(--color-accent-foreground)" : "transparent",
              }}
            >
              ✓
            </span>
          </button>

          <p className="mt-3 text-[12px] text-muted-foreground">
            Leave a field blank to record nothing for it. Clearing everything removes the day.
          </p>

          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-full py-3 text-[15px] font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex-[2] min-h-[44px] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground"
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

function NumField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  inputMode = "decimal",
  enterKeyHint = "next",
  onEnter,
  onStep,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  inputMode?: "decimal" | "numeric";
  enterKeyHint?: "next" | "done";
  onEnter?: () => void;
  onStep?: (dir: -1 | 1) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-1">
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(-1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
          >
            −
          </button>
        )}
        <div
          className={`flex min-w-0 flex-1 items-baseline gap-1 ${
            onStep ? "justify-center text-center" : ""
          }`}
        >
          <input
            ref={inputRef}
            inputMode={inputMode}
            enterKeyHint={enterKeyHint}
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => {
              e.target.select();
              e.target.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter?.();
              }
            }}
            placeholder={placeholder ?? "0"}
            className={`tnum w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-muted-foreground ${
              onStep ? "text-center" : ""
            }`}
          />
          {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
        </div>
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
