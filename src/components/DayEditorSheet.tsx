import { parse } from "date-fns";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type DailyLog } from "../lib/store";

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

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isCheatDay, setIsCheatDay] = useState(false);

  // Re-prefill each time the sheet opens (or the day being edited changes).
  // Reading dailyLogs off the store rather than through the selector keeps
  // this from re-running mid-edit when an unrelated day is written.
  useEffect(() => {
    if (!open) return;
    const existing = useStore.getState().dailyLogFor(date);
    setDraft(draftFrom(existing));
    setIsCheatDay(existing?.isCheatDay === true);
  }, [open, date]);

  if (!open || typeof document === "undefined") return null;

  const existing = dailyLogs.find((l) => l.date === date);

  const save = () => {
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
  };

  const setField = (key: NumKey) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <div className="mx-auto my-3 h-1 w-10 rounded-full bg-border" />

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
            />
            <NumField
              label="Steps"
              value={draft.steps}
              onChange={setField("steps")}
              placeholder="Not logged"
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <NumField
              label="Protein"
              suffix="g"
              value={draft.protein}
              onChange={setField("protein")}
              placeholder="0"
            />
            <NumField
              label="Carbs"
              suffix="g"
              value={draft.carbs}
              onChange={setField("carbs")}
              placeholder="0"
            />
            <NumField
              label="Fat"
              suffix="g"
              value={draft.fat}
              onChange={setField("fat")}
              placeholder="0"
            />
          </div>

          <div className="mt-3">
            <NumField
              label="Bodyweight"
              suffix={unit}
              value={draft.bodyweight}
              onChange={setField("bodyweight")}
              placeholder="Not logged"
            />
          </div>

          <button
            type="button"
            role="checkbox"
            aria-checked={isCheatDay}
            onClick={() => setIsCheatDay(!isCheatDay)}
            className="mt-3 flex w-full items-center justify-between rounded-xl bg-muted p-3 text-left"
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
              className="flex-1 rounded-full py-3 text-[15px] font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex-[2] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground"
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <input
          inputMode="decimal"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="tnum w-full min-w-0 bg-transparent text-[22px] font-semibold outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-muted-foreground"
        />
        {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
