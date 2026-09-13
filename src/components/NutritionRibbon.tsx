import { format } from "date-fns";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { dayKey, parseDayKey } from "../lib/daily-log";
import {
  RIBBON,
  addDaysToKey,
  daysBetweenKeys,
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

/** Pixels of travel before a press on a boundary commits to being a drag. */
const DRAG_SLOP = 4;

/**
 * The nutrition plan, as a thing you edit rather than a picture of one.
 *
 * The list this replaces was a readout: it drew the plan you had already built,
 * and every actual change dropped you into a sheet with a date picker. Here the
 * timeline IS the control surface -
 *
 *   DRAG A BOUNDARY to move a change-point. It snaps to whole days and shows
 *   the date it is landing on while you move it. This is for nudges: "start the
 *   cut a day later" is one drag, with the weeks either side of it moving under
 *   your thumb so you can see what you just decided.
 *
 *   TAP A PHASE to select it. Its numbers open directly underneath, and every
 *   one of them writes as you change it. There is no Save.
 *
 *   THE DATE FIELD is for jumps. A bulk that starts on 1 January 2027 is not a
 *   drag - it is nine months away - so the selected phase carries a real date
 *   input, and the ribbon rescales around wherever you put it.
 *
 * Drag for days, type for dates. That split is the whole interaction.
 */
export function NutritionRibbon() {
  const phases = useStore((s) => s.nutritionPhases);
  const addPhase = useStore((s) => s.addPhase);
  const updatePhase = useStore((s) => s.updatePhase);
  const deletePhase = useStore((s) => s.deletePhase);
  const setPhaseStart = useStore((s) => s.setPhaseStart);
  const hydrated = useStore((s) => s.hydrated);

  const today = dayKey(new Date());
  const ordered = sortPhases(phases);
  const segments = layoutRibbon(phases);
  const total = ribbonWidth(segments);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  /** The boundary being dragged, and where it has got to. Layout is FROZEN for
   *  the duration: reflowing mid-drag would move the boundary under the finger
   *  that is moving it, which feeds back into itself and jitters. */
  const [dragging, setDragging] = useState<{ id: string; date: string; x: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    origin: string;
    perDay: number;
    lo: string;
    hi: string;
    baseX: number;
    moved: boolean;
  } | null>(null);

  // Selection follows the plan: whatever is in force today, until you pick
  // something else. Re-runs when the phase list changes so a delete cannot
  // leave the editor pointing at nothing.
  useEffect(() => {
    if (!hydrated) return;
    setSelectedId((current) => {
      if (current && phases.some((p) => p.id === current)) return current;
      let inForce: NutritionPhase | undefined;
      for (const p of phases) {
        if (p.startsOn > today) continue;
        if (!inForce || p.startsOn > inForce.startsOn) inForce = p;
      }
      return (inForce ?? ordered[0])?.id;
    });
    // `ordered` is derived from `phases`; `today` only changes across midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases, hydrated, today]);

  const selected = ordered.find((p) => p.id === selectedId);
  const todayX = hydrated ? ribbonX(segments, today) : undefined;

  // --- dragging a change-point ---------------------------------------------

  const onHandleDown = (e: ReactPointerEvent, index: number) => {
    const seg = segments[index];
    const prev = segments[index - 1];
    if (!seg || !prev) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // A constant local days-per-pixel, taken from the two segments the boundary
    // sits between. Constant matters more than exact: the ribbon's scale is
    // piecewise by construction, so the alternative is a boundary that speeds
    // up as it crosses into a differently-scaled neighbour.
    const daysSpan = (prev.days ?? RIBBON.TAIL_DAYS) + (seg.days ?? RIBBON.TAIL_DAYS);
    const perDay = (prev.width + seg.width) / Math.max(1, daysSpan);

    dragRef.current = {
      id: seg.phase.id,
      startX: e.clientX,
      origin: seg.phase.startsOn,
      perDay,
      // Clamped a day clear of each neighbour, because two phases starting on
      // one day is a contradiction. The last boundary has no phase after it, so
      // its ceiling is simply a long way off.
      lo: addDaysToKey(prev.phase.startsOn, 1),
      hi: segments[index + 1]
        ? addDaysToKey(segments[index + 1].phase.startsOn, -1)
        : addDaysToKey(seg.phase.startsOn, 3650),
      baseX: seg.x,
      moved: false,
    };
    setError(null);
  };

  const onHandleMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    d.moved = true;
    const shift = Math.round(dx / d.perDay);
    let date = addDaysToKey(d.origin, shift);
    if (date < d.lo) date = d.lo;
    if (date > d.hi) date = d.hi;
    setDragging({
      id: d.id,
      date,
      x: d.baseX + daysBetweenKeys(d.origin, date) * d.perDay,
    });
  };

  const endDrag = () => {
    const d = dragRef.current;
    const landed = dragging;
    dragRef.current = null;
    setDragging(null);
    if (!d) return;
    if (!d.moved || !landed || landed.date === d.origin) {
      // A press that never moved is a selection, not a nudge.
      setSelectedId(d.id);
      return;
    }
    if (!setPhaseStart(d.id, landed.date)) setError("A phase already starts on that date");
    else setSelectedId(d.id);
  };

  // --- adding ---------------------------------------------------------------

  const addAfterLast = () => {
    const last = ordered[ordered.length - 1];
    // A week after the last change-point, or today when there is no plan yet.
    // The date is a starting point rather than a guess to live with: the field
    // in the editor below is open the moment this lands.
    const start = last ? addDaysToKey(last.startsOn, 7) : today;
    const created = addPhase({ startsOn: start, name: "Untitled", kind: "targets" });
    if (created) {
      setSelectedId(created.id);
      setError(null);
    } else {
      setError("A phase already starts on that date");
    }
  };

  return (
    <section className="anim-fade-up">
      <div className="px-4 group-header">
        <h2 className="t-caption">Nutrition</h2>
        <button type="button" onClick={addAfterLast} className="t-action t-label">
          Add
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="mx-4 group-list px-4 py-5">
          <p className="t-body text-ink-2">Nothing planned yet</p>
        </div>
      ) : (
        <>
          {/* Scrolls rather than fitting. See RIBBON in planning.ts for why. */}
          <div className="overflow-x-auto px-4 pb-1">
            <div className="relative h-[102px]" style={{ width: total + 8 }}>
              {segments.map((seg, i) => {
                const p = seg.phase;
                const isSelected = p.id === selectedId;
                const untracked = p.kind === "untracked";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-pressed={isSelected}
                    className={`absolute top-[18px] flex h-[60px] flex-col justify-center overflow-hidden rounded-lg px-2.5 text-left ${
                      untracked
                        ? "border border-dashed border-ink-3 bg-transparent"
                        : isSelected
                          ? "bg-ink text-paper"
                          : "bg-wash text-ink"
                    } ${seg.open ? "border-r-2 border-dashed border-ink-3" : ""}`}
                    style={{ left: seg.x, width: seg.width - 3 }}
                  >
                    <span className="truncate t-label font-semibold">{p.name}</span>
                    {/* Secondary tone by token, never by opacity: on the
                        selected chip that means a dark grey ON white, which is
                        the same rank stated in the other direction. */}
                    <span
                      className={`truncate t-label ${
                        untracked ? "text-ink-3" : isSelected ? "text-wash" : "text-ink-2"
                      }`}
                      style={{ fontSize: 11 }}
                    >
                      {seg.open ? "onward" : durationLabel(seg.days ?? 0)}
                    </span>

                    {/* The break mark. A segment drawn shorter than it really is
                        says so, rather than letting the eye read the width as
                        the duration. */}
                    {seg.capped && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-2 right-2 w-px border-l border-dashed ${
                          isSelected && !untracked ? "border-wash" : "border-ink-3"
                        }`}
                      />
                    )}
                  </button>
                );
              })}

              {/* The date under each change-point, which is also where a drag
                  lands - so the number you are aiming at is next to the thing
                  you are aiming it with. */}
              {segments.map((seg) => (
                <span
                  key={`d-${seg.phase.id}`}
                  className={`absolute top-[82px] whitespace-nowrap t-label ${
                    seg.phase.id === selectedId ? "text-ink" : "text-ink-3"
                  }`}
                  style={{ left: seg.x, fontSize: 11 }}
                >
                  {format(parseDayKey(seg.phase.startsOn), "d MMM")}
                </span>
              ))}

              {todayX !== undefined && (
                <span
                  className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
                  style={{ left: todayX }}
                >
                  <span className="t-label text-ink-2" style={{ fontSize: 10, lineHeight: 1 }}>
                    today
                  </span>
                  <span aria-hidden="true" className="mt-0.5 h-1.5 w-px bg-ink-2" />
                </span>
              )}

              {/* Grab handles, one per change-point after the first. */}
              {segments.slice(1).map((seg, i) => {
                const index = i + 1;
                const isDragging = dragging?.id === seg.phase.id;
                const at = isDragging ? dragging.x : seg.x;
                return (
                  <div
                    key={`h-${seg.phase.id}`}
                    role="separator"
                    aria-label={`Move the start of ${seg.phase.name}`}
                    onPointerDown={(e) => onHandleDown(e, index)}
                    onPointerMove={onHandleMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="absolute top-[18px] flex h-[60px] w-6 cursor-ew-resize touch-none items-center justify-center"
                    style={{ left: at - 12 }}
                  >
                    <span className="h-8 w-[3px] rounded-full bg-ink" />
                    {isDragging && (
                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 t-label font-semibold text-paper">
                        {format(parseDayKey(dragging.date), "d MMM")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="px-4 pb-1 t-label text-signal">{error}</p>}

          {selected && (
            <PhaseEditor
              key={selected.id}
              phase={selected}
              onPatch={(patch) => updatePhase(selected.id, patch)}
              onMove={(date) => {
                if (!setPhaseStart(selected.id, date)) {
                  setError("A phase already starts on that date");
                } else {
                  setError(null);
                }
              }}
              onDelete={() => deletePhase(selected.id)}
            />
          )}
        </>
      )}
    </section>
  );
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
        className={`min-h-[44px] ${width} bg-transparent text-right t-body outline-none placeholder:text-ink-3 ${
          wrong ? "text-signal" : "text-ink"
        }`}
      />
      {unit && <span className="t-label text-ink-3">{unit}</span>}
    </span>
  );
}

/**
 * The selected phase's numbers, open underneath the ribbon.
 *
 * Everything here writes on change. There is no Save button because there is no
 * sheet to dismiss - the thing you are editing is on screen above you, and it
 * moves as you type.
 */
function PhaseEditor({
  phase,
  onPatch,
  onMove,
  onDelete,
}: {
  phase: NutritionPhase;
  onPatch: (patch: Partial<Omit<NutritionPhase, "id">>) => void;
  onMove: (date: string) => void;
  onDelete: () => void;
}) {
  const untracked = phase.kind === "untracked";
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
          className="min-h-[44px] min-w-0 flex-1 bg-transparent text-right t-body text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="group-row group-row-sep">
        <label htmlFor="phase-start" className="t-body font-medium text-ink">
          Starts
        </label>
        {/* The jump, as against the drag. A native date input reaches January
            2027 in two taps, which no amount of dragging can. */}
        <input
          id="phase-start"
          type="date"
          value={phase.startsOn}
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="min-h-[44px] bg-transparent text-right t-body text-ink outline-none"
        />
      </div>

      <div className="group-row group-row-sep">
        <span className="t-body font-medium text-ink">Untracked</span>
        <button
          type="button"
          role="switch"
          aria-checked={untracked}
          aria-label="Untracked"
          onClick={() =>
            onPatch(
              untracked
                ? { kind: "targets" }
                : // Dropping the numbers is the point: an untracked phase that
                  // quietly kept its targets would resurrect them the moment the
                  // switch went back.
                  {
                    kind: "untracked",
                    calories: undefined,
                    protein: undefined,
                    carbs: undefined,
                    fat: undefined,
                    steps: undefined,
                  },
            )
          }
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            untracked ? "bg-ink" : "bg-paper ring-1 ring-inset ring-ink-3"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
              untracked ? "left-6 bg-paper" : "left-1 bg-ink-3"
            }`}
          />
        </button>
      </div>

      {!untracked && (
        <>
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
        </>
      )}

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
