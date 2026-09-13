import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore } from "../lib/store";
import { GOAL_MODES, TARGET_FIELDS, type GoalMode, type TargetField } from "../lib/targets";
import type { NutritionPhase, NutritionPhaseKind } from "../lib/planning";

const FIELD_LABELS: Record<TargetField, string> = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  steps: "Steps",
};

const FIELD_UNITS: Partial<Record<TargetField, string>> = {
  calories: "kcal",
  protein: "g",
  carbs: "g",
  fat: "g",
};

const GOAL_LABELS: Record<GoalMode, string> = {
  cut: "Cutting",
  maintain: "Maintaining",
  gain: "Gaining",
};

type Draft = Record<TargetField, string>;

const EMPTY: Draft = { calories: "", protein: "", carbs: "", fat: "", steps: "" };

/** "" means not set, never 0. A typed 0 is kept, matching DayEditorSheet. */
function toValue(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function draftFrom(phase: NutritionPhase | undefined): Draft {
  if (!phase) return { ...EMPTY };
  const show = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    calories: show(phase.calories),
    protein: show(phase.protein),
    carbs: show(phase.carbs),
    fat: show(phase.fat),
    steps: show(phase.steps),
  };
}

/**
 * One change-point on the nutrition timeline.
 *
 * The date is the whole point of the entity, so it is the first field and it is
 * always editable: "I want to start cutting on the 20th" is the sentence this
 * screen exists to write. There is no end date to set, because a phase runs
 * until the next one starts.
 */
export function PhaseEditorSheet({
  phase,
  open,
  onClose,
}: {
  /** Editing an existing phase, or undefined to add one. */
  phase: NutritionPhase | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const addPhase = useStore((s) => s.addPhase);
  const updatePhase = useStore((s) => s.updatePhase);
  const deletePhase = useStore((s) => s.deletePhase);
  const phases = useStore((s) => s.nutritionPhases);

  const [startsOn, setStartsOn] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NutritionPhaseKind>("targets");
  const [goalMode, setGoalMode] = useState<GoalMode>("maintain");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStartsOn(phase?.startsOn ?? new Date().toISOString().slice(0, 10));
    setName(phase?.name ?? "");
    setKind(phase?.kind ?? "targets");
    setGoalMode(phase?.goalMode ?? "maintain");
    setDraft(draftFrom(phase));
    setError(null);
  }, [open, phase]);

  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const save = () => {
    const taken = phases.some((p) => p.startsOn === startsOn && p.id !== phase?.id);
    if (taken) {
      // Two phases starting on one day is a contradiction rather than something
      // to resolve with a tiebreak nobody would remember, so it is refused here
      // instead of being silently reordered later.
      setError("A phase already starts on that date");
      return;
    }
    const numbers =
      kind === "targets"
        ? Object.fromEntries(TARGET_FIELDS.map((f) => [f, toValue(draft[f])]))
        : Object.fromEntries(TARGET_FIELDS.map((f) => [f, undefined]));

    const body = {
      startsOn,
      name: name.trim() || (kind === "untracked" ? "Untracked" : "Targets"),
      kind,
      ...numbers,
      ...(kind === "targets" ? { goalMode } : { goalMode: undefined }),
    };

    if (phase) updatePhase(phase.id, body);
    else addPhase(body as Omit<NutritionPhase, "id">);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/25 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface p-5 anim-sheet rounded-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-wash" />

        <h2 className="t-heading text-ink">{phase ? "Edit phase" : "New phase"}</h2>

        <div className="mt-4 group-list bg-wash">
          <div className="group-row">
            <label htmlFor="phase-start" className="t-body font-medium text-ink">
              Starts
            </label>
            <input
              id="phase-start"
              type="date"
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value);
                setError(null);
              }}
              className="min-h-[44px] bg-transparent t-body text-ink outline-none"
            />
          </div>

          <div className="group-row group-row-sep">
            <label htmlFor="phase-name" className="t-body font-medium text-ink">
              Name
            </label>
            <input
              id="phase-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "untracked" ? "Untracked" : "Cut"}
              className="min-h-[44px] flex-1 bg-transparent text-right t-body text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        </div>

        <div
          role="group"
          aria-label="Phase kind"
          className="mt-4 inline-flex w-full gap-1 rounded-md bg-wash p-1"
        >
          {(["targets", "untracked"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={
                "flex min-h-[40px] flex-1 items-center justify-center rounded-sm px-3 t-label font-medium transition-colors " +
                (kind === k ? "bg-ink text-paper" : "text-ink-2")
              }
            >
              {k === "targets" ? "Targets" : "Untracked"}
            </button>
          ))}
        </div>

        {kind === "targets" && (
          <>
            <div
              role="group"
              aria-label="Goal"
              className="mt-3 inline-flex w-full gap-1 rounded-md bg-wash p-1"
            >
              {GOAL_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setGoalMode(m)}
                  aria-pressed={goalMode === m}
                  className={
                    "flex min-h-[40px] flex-1 items-center justify-center rounded-sm px-2 t-label font-medium transition-colors " +
                    (goalMode === m ? "bg-ink text-paper" : "text-ink-2")
                  }
                >
                  {GOAL_LABELS[m]}
                </button>
              ))}
            </div>

            <div className="mt-4 group-list bg-wash">
              {TARGET_FIELDS.map((f, i) => (
                <div key={f} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
                  <label htmlFor={`phase-${f}`} className="t-body font-medium text-ink">
                    {FIELD_LABELS[f]}
                  </label>
                  <div className="flex items-baseline gap-1">
                    <input
                      id={`phase-${f}`}
                      type="number"
                      inputMode="numeric"
                      value={draft[f]}
                      onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                      className="w-24 bg-transparent text-right t-stat text-ink outline-none"
                    />
                    {FIELD_UNITS[f] && <span className="t-label text-ink-2">{FIELD_UNITS[f]}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="mt-3 t-label text-signal">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          {phase && (
            <button
              onClick={() => {
                deletePhase(phase.id);
                onClose();
              }}
              className="min-h-[44px] px-3 t-body font-medium text-signal"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex-1 min-h-[44px] rounded-lg bg-ink py-3 t-body font-semibold text-paper"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
