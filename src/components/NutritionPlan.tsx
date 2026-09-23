import { format } from "date-fns";
import { useEffect, useState } from "react";
import { dayKey, parseDayKey } from "../lib/daily-log";
import {
  addDaysToKey,
  durationLabel,
  layoutRibbon,
  ribbonWidth,
  ribbonX,
  sortPhases,
  type NutritionPhase,
} from "../lib/planning";
import { useStore } from "../lib/store";
import {
  MACRO_FIELDS,
  macrosExceedCalories,
  suggestMacroGrams,
  type MacroField,
  type TargetField,
} from "../lib/targets";
import { Trash } from "./icons";
import { usePlanLocked } from "../lib/plan-lock";

const FIELD_LABELS: Record<TargetField, string> = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  steps: "Steps",
};

const FIELD_UNITS: Partial<Record<TargetField, string>> = {
  calories: "kcal",
  steps: "",
};

/** The two fields a target rule applies to: calories are a ceiling, steps a
 *  floor. Each gets a row of its own. */
const RULED_FIELDS = ["calories", "steps"] as const;

const MACRO_INITIALS: Record<MacroField, string> = {
  protein: "p",
  carbs: "c",
  fat: "f",
};

/**
 * The nutrition plan: a list of dated stretches, and the one you are editing.
 *
 * This replaces a RIBBON - a proportional timeline you dragged change-points
 * around on. It was the better-looking thing and the worse one to use. Three
 * problems, and the third is why it is gone rather than fixed:
 *
 *   A drag is an imprecise gesture for an exact value. Landing on the 14th
 *   rather than the 13th took a steady thumb, and the only recourse was the
 *   date field in the editor below - which is to say, the thing that replaced
 *   it was already there.
 *
 *   It could not draw a gap, because the model could not hold one. A phase ran
 *   until the next began, so "nothing planned for these six weeks" was
 *   unsayable, and the ribbon was continuous because the data had no choice.
 *
 *   And dragging a boundary moved TWO phases at once - the one you grabbed and
 *   the one before it, which silently got longer. One gesture, two edits, and
 *   only one of them visible at the moment you made it.
 *
 * A list of ranges says the same thing with dates you type, and gaps between
 * rows are simply rows that do not touch.
 */
export function NutritionPlan() {
  const locked = usePlanLocked();
  const phases = useStore((s) => s.nutritionPhases);
  const addPhase = useStore((s) => s.addPhase);
  const updatePhase = useStore((s) => s.updatePhase);
  const deletePhase = useStore((s) => s.deletePhase);
  const setPhaseDates = useStore((s) => s.setPhaseDates);
  const hydrated = useStore((s) => s.hydrated);

  const today = dayKey(new Date());
  const ordered = sortPhases(phases);
  const segments = layoutRibbon(phases);
  const total = ribbonWidth(segments);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Selection follows the plan: whatever covers today, until you pick something
  // else. Re-runs when the list changes so a delete cannot leave the editor
  // pointing at nothing.
  //
  // Falls back to the LAST phase rather than the first when today is in a gap:
  // an empty stretch is usually the space after a plan ran out, so the row you
  // want is the one that just ended, not the one from two years ago.
  useEffect(() => {
    if (!hydrated) return;
    setSelectedId((current) => {
      if (current && phases.some((p) => p.id === current)) return current;
      const sorted = sortPhases(phases);
      const covering = sorted.find(
        (p) => p.startsOn <= today && (p.endsOn === undefined || p.endsOn >= today),
      );
      return (covering ?? sorted[sorted.length - 1])?.id;
    });
  }, [phases, hydrated, today]);

  const selected = ordered.find((p) => p.id === selectedId);
  // Suppressed until hydration: the server has no phases, so a marker placed
  // during SSR would be drawn at a position the client immediately disagrees with.
  const todayX = hydrated ? ribbonX(segments, today) : undefined;

  /**
   * A new phase starts the day after the plan currently runs out, or today when
   * there is none.
   *
   * Deliberately not "a week after the last one started", which is what the
   * ribbon did: that was a guess dressed as a default, and with real end dates
   * there is a correct answer. Butting the new phase up against the old one
   * also keeps `addPhase` off its overlap path in the ordinary case.
   */
  const addNext = () => {
    const last = ordered[ordered.length - 1];
    const start = last ? maxDayKey(addDaysToKey(last.endsOn ?? last.startsOn, 1), today) : today;
    const created = addPhase({ startsOn: start, name: "Untitled" });
    if (created) {
      setSelectedId(created.id);
      setError(null);
    } else {
      setError("Those dates overlap a phase you already have");
    }
  };

  const moveDates = (dates: { startsOn?: string; endsOn?: string | null }) => {
    if (!selected) return;
    if (setPhaseDates(selected.id, dates)) setError(null);
    else setError("Those dates overlap a phase you already have");
  };

  return (
    <section>
      <div className="px-4 group-header">
        <h2 className="t-caption">Nutrition</h2>
        {!locked && (
          <button type="button" onClick={addNext} className="t-action t-label">
            Add
          </button>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="mx-4 group-list px-4 py-5">
          <p className="t-body text-ink-2">Nothing planned yet</p>
        </div>
      ) : (
        <>
          {/* Scrolls rather than fits. See RIBBON in planning.ts for why, and
              note what is NOT here: a drag. The boundary handles are gone. A
              drag is an imprecise gesture for an exact date, and it moved two
              phases at once while showing one. Dates are typed in the editor
              below; the ribbon is how you read the plan and how you pick the
              stretch to edit. */}
          <div className="overflow-x-auto px-4 pb-1">
            <div className="relative h-[76px]" style={{ width: total + 8 }}>
              {segments.map((seg, i) => {
                const phase = seg.phase;

                // A GAP. Bare ground at true scale, drawn as a hairline-bounded
                // empty track rather than as a segment, because there is nothing
                // there - that is the fact it exists to state. Not tappable:
                // there is nothing to select.
                if (!phase) {
                  return (
                    <div
                      key={`gap-${i}`}
                      aria-hidden="true"
                      className="absolute top-0 flex h-[52px] items-center justify-center rounded-md border border-dashed border-rule"
                      style={{ left: seg.x + 2, width: Math.max(0, seg.width - 4) }}
                    >
                      {seg.capped && seg.days !== undefined && (
                        <span className="t-caption text-ink-3">{durationLabel(seg.days)}</span>
                      )}
                    </div>
                  );
                }

                const isSelected = phase.id === selectedId;
                const covering =
                  phase.startsOn <= today && (phase.endsOn === undefined || phase.endsOn >= today);
                return (
                  <button
                    key={phase.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(phase.id);
                      setError(null);
                    }}
                    aria-pressed={isSelected}
                    aria-label={`${phase.name}, ${rangeLine(phase)}`}
                    className={`absolute top-0 flex h-[52px] flex-col justify-center overflow-hidden rounded-md px-2 text-left ${
                      isSelected ? "bg-ink text-paper" : "bg-surface text-ink"
                    }`}
                    style={{ left: seg.x + 2, width: Math.max(0, seg.width - 4) }}
                  >
                    <span className="truncate t-label font-medium">{phase.name}</span>
                    {/* The honesty half of the capping rule: a segment drawn
                        shorter than it really is prints its real length. */}
                    {seg.capped && seg.days !== undefined && (
                      <span
                        className={`truncate t-caption ${isSelected ? "text-paper" : "text-ink-3"}`}
                      >
                        {durationLabel(seg.days)}
                      </span>
                    )}
                    {seg.open && (
                      <span
                        className={`truncate t-caption ${isSelected ? "text-paper" : "text-ink-3"}`}
                      >
                        ongoing
                      </span>
                    )}
                  </button>
                );
              })}

              {/* The date under each phase's left edge, so the ribbon can be
                  read as a calendar rather than only as a picture. */}
              {segments.map((seg, i) =>
                seg.phase ? (
                  <span
                    key={`date-${seg.phase.id}`}
                    className="absolute top-[56px] t-caption text-ink-3"
                    style={{ left: seg.x + 2 }}
                  >
                    {format(parseDayKey(seg.phase.startsOn), "d MMM")}
                  </span>
                ) : (
                  <span key={`nodate-${i}`} />
                ),
              )}

              {/* Today, as a rule straight down the ribbon. */}
              {todayX !== undefined && (
                <div
                  aria-hidden="true"
                  className="absolute top-0 h-[52px] w-px bg-accent"
                  style={{ left: todayX }}
                />
              )}
            </div>
          </div>

          {error && <p className="px-4 pt-1 t-label text-signal">{error}</p>}

          {selected && (
            <PhaseEditor
              key={selected.id}
              phase={selected}
              onPatch={(patch) => updatePhase(selected.id, patch)}
              onDates={moveDates}
              onDelete={() => deletePhase(selected.id)}
            />
          )}
        </>
      )}
    </section>
  );
}

/** The later of two day keys. Zero-padded, so this is a string comparison. */
function maxDayKey(a: string, b: string): string {
  return a > b ? a : b;
}

/** "12 Jan — 4 Mar", or "12 Jan — ongoing". An en dash, not a hyphen: it is a
 *  range, and that is the mark for one. */
function rangeLine(phase: NutritionPhase): string {
  const from = format(parseDayKey(phase.startsOn), "d MMM yyyy");
  const to = phase.endsOn ? format(parseDayKey(phase.endsOn), "d MMM yyyy") : "ongoing";
  return `${from} – ${to}`;
}

function NumberField({
  field,
  phase,
  onPatch,
  width,
  suggestion,
  wrong,
}: {
  field: TargetField;
  phase: NutritionPhase;
  onPatch: (patch: Partial<Omit<NutritionPhase, "id">>) => void;
  width: string;
  /** Shown as the placeholder when the field is empty. A suggestion, never a
   *  value: nothing here writes a number the user did not type. */
  suggestion?: number;
  /** Whether what is in this field is in conflict with the calorie target. */
  wrong?: boolean;
}) {
  const unit = FIELD_UNITS[field];
  return (
    <span className="flex items-baseline gap-1.5">
      <input
        id={`phase-${field}`}
        type="number"
        inputMode="numeric"
        aria-label={FIELD_LABELS[field]}
        value={phase[field] === undefined ? "" : String(phase[field])}
        onChange={(e) => {
          const t = e.target.value.trim();
          const n = Number(t);
          // "" means not set, never 0. A typed 0 is kept.
          onPatch({ [field]: t === "" || !Number.isFinite(n) ? undefined : n });
        }}
        placeholder={suggestion === undefined ? "—" : String(suggestion)}
        className={`min-h-[44px] ${width} rounded-md bg-field px-2 text-right t-body outline-none placeholder:text-ink-3 ${
          wrong ? "text-signal" : "text-ink"
        }`}
      />
      {unit && <span className="t-label text-ink-3">{unit}</span>}
    </span>
  );
}

/**
 * The selected phase's dates, numbers and note, open underneath the list.
 *
 * Everything here writes on change. There is no Save button because there is no
 * sheet to dismiss - the row you are editing is on screen above you, and it
 * moves as you type. The dates are the exception in kind rather than in
 * mechanism: they can be REFUSED, so they go through a call that returns
 * whether it took, and the message appears above.
 */
function PhaseEditor({
  phase,
  onPatch,
  onDates,
  onDelete,
}: {
  phase: NutritionPhase;
  onPatch: (patch: Partial<Omit<NutritionPhase, "id">>) => void;
  onDates: (dates: { startsOn?: string; endsOn?: string | null }) => void;
  onDelete: () => void;
}) {
  const overspent = macrosExceedCalories(phase);

  return (
    <div className="mx-4 mt-3 group-list">
      <div className="group-row">
        <label htmlFor="phase-name" className="t-body font-medium text-ink">
          Name
        </label>
        <input
          id="phase-name"
          type="text"
          value={phase.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Cut"
          className="min-h-[44px] min-w-0 flex-1 rounded-md bg-field px-3 text-right t-body text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="group-row group-row-sep">
        <label htmlFor="phase-start" className="t-body font-medium text-ink">
          Starts
        </label>
        <input
          id="phase-start"
          type="date"
          value={phase.startsOn}
          onChange={(e) => e.target.value && onDates({ startsOn: e.target.value })}
          className="min-h-[44px] rounded-md bg-field px-2 text-right t-body text-ink outline-none"
        />
      </div>

      <div className="group-row group-row-sep">
        <label htmlFor="phase-end" className="t-body font-medium text-ink">
          Ends
        </label>
        {/* Emptying the field REOPENS the phase rather than failing to parse.
            That is the whole of the "ongoing" state: you know when a cut began
            and not when it will end, and a plan should not have to invent a
            date to satisfy its own schema. */}
        <input
          id="phase-end"
          type="date"
          value={phase.endsOn ?? ""}
          min={phase.startsOn}
          onChange={(e) => onDates({ endsOn: e.target.value || null })}
          className="min-h-[44px] rounded-md bg-field px-2 text-right t-body text-ink outline-none"
        />
      </div>

      {RULED_FIELDS.map((f) => (
        <div key={f} className="group-row group-row-sep">
          <label htmlFor={`phase-${f}`} className="t-body font-medium text-ink">
            {FIELD_LABELS[f]}
          </label>
          <NumberField field={f} phase={phase} onPatch={onPatch} width="w-24" />
        </div>
      ))}

      {/* One row, because it is one decision. Calories and steps each have a
          rule - a ceiling and a floor - and get a row apiece for it. A macro
          has no rule in either direction, so three of them side by side is
          the honest shape: three numbers you are aiming at.

          What the three DO have is an arithmetic relationship with the
          calorie target three rows above them. Fill two and the third is
          suggested in grey; put in a set that spends more than the target
          and they turn red. Neither is a rule about macros - it is the row
          saying out loud that these numbers add up to that one. */}
      <div className="group-row group-row-sep">
        <span className={`t-body font-medium ${overspent ? "text-signal" : "text-ink"}`}>
          Macros
        </span>
        <span className="flex items-baseline gap-1">
          {MACRO_FIELDS.map((f) => (
            <span key={f} className="flex items-baseline">
              <NumberField
                field={f}
                phase={phase}
                onPatch={onPatch}
                width="w-11"
                suggestion={suggestMacroGrams(phase, f)}
                wrong={overspent && phase[f] !== undefined}
              />
              <label
                htmlFor={`phase-${f}`}
                className={`t-label ${overspent ? "text-signal" : "text-ink-3"}`}
              >
                {MACRO_INITIALS[f]}
              </label>
            </span>
          ))}
        </span>
      </div>

      {/* Last, and the only field here that is not a number.

          A textarea rather than an input because what goes in it is a coach
          writing a paragraph to a client - "keep protein up on rest days, we'll
          reassess after the meet" - and a one-line box that scrolls sideways
          tells you to be brief about something you should not be brief about.
          It travels with the plan, so the instruction arrives attached to the
          weeks it is about. */}
      <div className="group-row-sep px-4 py-3">
        <label htmlFor="phase-note" className="t-label text-ink-2">
          Note
        </label>
        <textarea
          id="phase-note"
          rows={3}
          value={phase.note ?? ""}
          onChange={(e) => onPatch({ note: e.target.value.trim() ? e.target.value : undefined })}
          placeholder="What these weeks are for"
          className="mt-1.5 w-full resize-none rounded-md bg-field px-3 py-2 t-body text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="group-row group-row-sep">
        <button
          type="button"
          onClick={onDelete}
          className="flex min-h-[44px] items-center gap-2 t-body font-medium text-signal"
        >
          <Trash size={16} />
          Delete phase
        </button>
      </div>
    </div>
  );
}
