import { useEffect, useMemo, useState } from "react";
import { seedExercises } from "../lib/exercise-library";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { kindOf, type SplitCardKind } from "../lib/planning";
import { useStore, type Exercise, type PlannedLift, type SplitSlot } from "../lib/store";
import { Close } from "./icons";
import { Reorder } from "./SplitCardList";

/**
 * One card in the workout split.
 *
 * A card is a slot rather than a weekday, because the split it belongs to has no
 * weekdays in it: UL×infinity advances when you train. Picking the lifts for
 * "Upper" once is what a plan is here, and it holds for every Upper you ever do.
 *
 * Two toggles decide what kind of card it is, and they are mutually exclusive
 * rather than independent, because a card is one thing:
 *
 *   REST is a day. It is spent by choosing it, and spending it moves the split
 *   on, but it has no lifts to pick.
 *
 *   REPEAT is not a day at all. Reaching one sends the split back to its first
 *   card, which is the whole trick behind "Upper, Lower, forever, with a rest
 *   when I say so" - the repeat sits between Lower and Rest, so Rest is never
 *   arrived at by accident.
 *
 * Cardio is filtered out of the picker for the same reason the log sheet filters
 * it: a cardio bout produces no sets, so preloading one would open the workout
 * onto an exercise the set logger cannot log.
 */
export function SlotPlanSheet({
  slot,
  open,
  onClose,
}: {
  /** The card being edited, or undefined when adding a new one. */
  slot: SplitSlot | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const setSlotLifts = useStore((s) => s.setSlotLifts);
  const setSlotCardio = useStore((s) => s.setSlotCardio);
  const templates = useStore((s) => s.templates);
  const saveTemplateFrom = useStore((s) => s.saveTemplateFrom);
  const applyTemplateLifts = useStore((s) => s.applyTemplate);
  const addExercise = useStore((s) => s.addExercise);
  const addSplitCard = useStore((s) => s.addSplitCard);
  const updateSplitCard = useStore((s) => s.updateSplitCard);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SplitCardKind>("workout");
  const [picked, setPicked] = useState<PlannedLift[]>([]);
  const [query, setQuery] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [cardioId, setCardioId] = useState<string | undefined>(undefined);
  const [minutes, setMinutes] = useState("");
  const [distance, setDistance] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(slot?.name ?? "");
    setKind(slot ? kindOf(slot) : "workout");
    setPicked(slot?.plannedLifts ?? []);
    setQuery("");
    setSaveAsTemplate(false);
    setCardioId(slot?.plannedCardio?.exerciseId);
    setMinutes(
      slot?.plannedCardio?.durationMinutes === undefined
        ? ""
        : String(slot.plannedCardio.durationMinutes),
    );
    setDistance(
      slot?.plannedCardio?.distance === undefined ? "" : String(slot.plannedCardio.distance),
    );
  }, [open, slot]);

  useSheetDismiss(open, onClose);

  const liftable = useMemo(() => exercises.filter((e) => e.type !== "cardio"), [exercises]);

  /** The chosen lifts, resolved and in the order the workout will open them.
   *  Ids whose exercise has since been deleted drop out here rather than
   *  rendering a blank row. */
  const chosen = useMemo(
    () =>
      picked
        .map((lift) => {
          const exercise = liftable.find((e) => e.id === lift.exerciseId);
          return exercise ? { lift, exercise } : undefined;
        })
        .filter((c): c is { lift: PlannedLift; exercise: Exercise } => c !== undefined),
    [liftable, picked],
  );

  /**
   * Everything not already chosen, filtered by the search box: this device's
   * exercises first, then the preset library for anything it has never heard of.
   *
   * The presets matter most in coach mode, where the store holds a CLIENT's
   * exercises - rebuilt from their sheet, so it contains only what they have
   * logged or been prescribed. Without this a coach writing "Face Pull" for the
   * first time had to type it from memory. A preset is not a record until it is
   * picked; choosing one creates it, exactly as typing the name would.
   */
  const library = useMemo(() => {
    const q = query.trim().toLowerCase();
    const known = new Set(liftable.map((e) => e.name.trim().toLowerCase()));
    const pickedIds = new Set(picked.map((lift) => lift.exerciseId));
    const pool: Array<Exercise & { preset?: true }> = liftable.filter((e) => !pickedIds.has(e.id));
    for (const preset of seedExercises) {
      if (preset.type === "cardio" || known.has(preset.name.trim().toLowerCase())) continue;
      pool.push({ ...preset, preset: true });
    }
    return (q ? pool.filter((e) => e.name.toLowerCase().includes(q)) : pool).slice(0, 40);
  }, [liftable, query, picked]);

  if (!open || typeof document === "undefined") return null;

  const add = (id: string) =>
    setPicked((p) => (p.some((lift) => lift.exerciseId === id) ? p : [...p, { exerciseId: id }]));

  /** Edits one lift's prescription in place. A blank field clears it. */
  const prescribe = (id: string, patch: Partial<Omit<PlannedLift, "exerciseId">>) =>
    setPicked((p) => p.map((lift) => (lift.exerciseId === id ? { ...lift, ...patch } : lift)));

  /**
   * Whether the typed name is worth offering to create.
   *
   * Checked against EVERY exercise, not against the filtered list: the library
   * below already hides anything chosen, and cardio never appears in it at all,
   * so matching on what is visible would offer to create a second "Incline
   * Press" the moment the first one was ticked.
   */
  const typed = query.trim();
  const canCreate =
    typed.length > 0 &&
    !exercises.some((e) => e.name.toLowerCase() === typed.toLowerCase()) &&
    // Nor a preset the list is already offering, or "Face Pull" would appear
    // twice: once to pick, once to create.
    !seedExercises.some((e) => e.name.toLowerCase() === typed.toLowerCase());

  const create = () => {
    // Accessory, matching the log sheet's picker. It is the type that assumes
    // least, and the exercise page is where a type gets corrected.
    add(addExercise(typed, "accessory").id);
    setQuery("");
  };
  const remove = (id: string) => setPicked((p) => p.filter((lift) => lift.exerciseId !== id));

  /** Same reordering the split cards get, for the same reason: the order is
   *  meaningful - it is the order the workout opens these lifts in - so it has
   *  to be changeable without retyping the whole list. */
  const move = (from: number, to: number) =>
    setPicked((p) => {
      if (to < 0 || to >= p.length) return p;
      const next = [...p];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  /** Every toggle off means a normal workout card, so turning one on turns the
   *  others off rather than producing a card that is two things. */
  const setToggle = (which: "rest" | "repeat" | "cardio", on: boolean) =>
    setKind(on ? which : "workout");

  /** Cardio activities only. A bout produces no sets, so the strength picker
   *  filters these out and this one is the other half of that split. */
  const cardioOptions = exercises.filter((e) => e.type === "cardio");

  // "" means not set, never 0. A typed 0 would be a bout of no length, which is
  // not a thing to prescribe.
  const asNumber = (raw: string): number | undefined => {
    const t = raw.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const minutesValue = asNumber(minutes);
  const distanceValue = asNumber(distance);

  const save = () => {
    const target = slot ?? addSplitCard({ name, kind });
    if (slot) updateSplitCard(slot.id, { name, kind });
    if (kind === "workout" && target) setSlotLifts(target.id, picked);
    // Written for a workout card AND a cardio one, because the two shapes are
    // both real: a conditioning day, and twenty minutes on the bike after the
    // lifts. A rest or a repeat carries neither.
    if (target && (kind === "workout" || kind === "cardio")) {
      setSlotCardio(
        target.id,
        cardioId === undefined
          ? undefined
          : {
              exerciseId: cardioId,
              ...(minutesValue === undefined ? {} : { durationMinutes: minutesValue }),
              ...(distanceValue === undefined ? {} : { distance: distanceValue }),
            },
      );
    }
    // Saving the card is what makes it a template: a template of an
    // unsaved card would describe something that does not exist yet.
    if (saveAsTemplate && target) saveTemplateFrom(target.id, name);
    onClose();
  };

  /**
   * Drops a template's lifts into the card being edited.
   *
   * Applied to the card rather than to the draft because a template carries
   * NAMES: resolving them to this device's exercises is the store's job, and
   * in coach mode "this device" is the client whose plan is on screen.
   */
  const applyTemplate = (templateId: string) => {
    const target = slot ?? addSplitCard({ name, kind });
    if (!target) return;
    applyTemplateLifts(templateId, target.id);
    const applied = useStore.getState().slots.find((sl) => sl.id === target.id);
    setPicked(applied?.plannedLifts ?? []);
  };

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/25 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col bg-surface p-5 anim-sheet rounded-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-wash" />

        <h2 className="shrink-0 t-heading text-ink">{slot ? "Edit card" : "New card"}</h2>

        <div className="mt-4 shrink-0 group-list bg-wash">
          {kind !== "repeat" && (
            <div className="group-row">
              <label htmlFor="card-name" className="t-body font-medium text-ink">
                Name
              </label>
              <input
                id="card-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === "rest" ? "Rest" : "Upper"}
                className="min-h-[44px] flex-1 bg-transparent text-right t-body text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          )}

          <div className={`group-row ${kind !== "repeat" ? "group-row-sep" : ""}`}>
            <span className="t-body font-medium text-ink">Rest day</span>
            <Switch on={kind === "rest"} label="Rest day" onChange={(v) => setToggle("rest", v)} />
          </div>

          <div className="group-row group-row-sep">
            <span className="t-body font-medium text-ink">Cardio day</span>
            <Switch
              on={kind === "cardio"}
              label="Cardio day"
              onChange={(v) => setToggle("cardio", v)}
            />
          </div>

          <div className="group-row group-row-sep">
            <span className="t-body font-medium text-ink">Repeat</span>
            <Switch
              on={kind === "repeat"}
              label="Repeat"
              onChange={(v) => setToggle("repeat", v)}
            />
          </div>
        </div>

        {(kind === "workout" || kind === "cardio") && (
          /* On a workout card this is a FINISHER - lifts, then twenty minutes
             on the bike. On a cardio card it is the whole day. Same editor
             either way, because it is the same prescription; what differs is
             whether there are lifts above it. */
          <div className="mt-4 shrink-0">
            <div className="group-header">
              <h3 className="t-caption">{kind === "cardio" ? "Activity" : "Cardio finisher"}</h3>
            </div>
            <div className="group-list">
              <div className="group-row">
                <label htmlFor="card-cardio" className="t-body font-medium text-ink">
                  Activity
                </label>
                <select
                  id="card-cardio"
                  value={cardioId ?? ""}
                  onChange={(e) => setCardioId(e.target.value || undefined)}
                  className="min-h-[44px] bg-transparent text-right t-body text-ink outline-none"
                >
                  {/* Blank is a real choice on a cardio card: "do some cardio"
                      without saying which is a legitimate thing to plan. */}
                  <option value="">None</option>
                  {cardioOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>

              {cardioId !== undefined && (
                <>
                  <div className="group-row group-row-sep">
                    <label htmlFor="card-cardio-mins" className="t-body font-medium text-ink">
                      Minutes
                    </label>
                    <input
                      id="card-cardio-mins"
                      type="number"
                      inputMode="numeric"
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      placeholder="—"
                      className="min-h-[44px] w-24 bg-transparent text-right t-body text-ink outline-none placeholder:text-ink-3"
                    />
                  </div>
                  <div className="group-row group-row-sep">
                    <label htmlFor="card-cardio-dist" className="t-body font-medium text-ink">
                      Distance
                    </label>
                    <input
                      id="card-cardio-dist"
                      type="number"
                      inputMode="decimal"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      placeholder="—"
                      className="min-h-[44px] w-24 bg-transparent text-right t-body text-ink outline-none placeholder:text-ink-3"
                    />
                  </div>
                </>
              )}
            </div>
            {/* Neither number implies the other. "20 minutes on the bike" and
                "5k, however long it takes" are both complete instructions. */}
          </div>
        )}

        {kind === "repeat" && (
          // The one place a sentence is warranted: a repeat is the only card
          // whose behaviour you cannot work out by looking at it.
          <p className="mt-3 shrink-0 t-label text-ink-2">
            Sends the split back to the first card instead of being a day of its own
          </p>
        )}

        {kind === "workout" && (
          /*
            ONE SCROLLER FOR BOTH LISTS.
            
            These were two panes sharing the sheet's fixed height, and two panes
            that both want to grow will always starve one of the other. The
            chosen list was `shrink-0` with no ceiling, so every lift added to
            it took height out of the library below - which is `min-h-0`, and
            therefore shrinks all the way to nothing. By the fourth chosen lift
            the library's rows were still being laid out but had no height to
            occupy, so a search looked like it matched nothing and "Add ..."
            never appeared either.
            
            Capping one and flooring the other just moved the starvation to the
            other pane. Both lists live at their natural height in a single
            scrolling region now, which cannot express the problem at all.
          */
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {/* Chosen first, and in ORDER, because the order is the plan: the
                workout opens on whatever sits at the top of this list. The
                single mixed list this replaced put chosen lifts above unchosen
                ones with a tick each, which showed the order but gave you no
                way to change it. */}
            {chosen.length > 0 && (
              <div>
                <div className="group-header">
                  <h3 className="t-caption">Chosen</h3>
                </div>
                <div className="group-list bg-wash">
                  {chosen.map(({ lift, exercise: e }, i) => (
                    <div key={e.id} className={`px-4 py-2 ${i === 0 ? "" : "group-row-sep"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate t-body text-ink">{e.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Reorder
                            label={e.name}
                            index={i}
                            count={chosen.length}
                            onMove={(to) => move(i, to)}
                          />
                          <button
                            type="button"
                            aria-label={`Remove ${e.name}`}
                            onClick={() => remove(e.id)}
                            className="flex h-11 w-9 items-center justify-center text-ink-3"
                          >
                            <Close size={16} />
                          </button>
                        </span>
                      </div>
                      {/* Sets, reps and load, all optional: a lift with none is
                          what every card held before prescriptions existed.
                          Reps and load are text because "8-12" and "RPE 8" are
                          how programmes are written. */}
                      <div className="flex gap-2 pb-1">
                        <Prescribe
                          label={`${e.name} sets`}
                          placeholder="Sets"
                          value={lift.sets === undefined ? "" : String(lift.sets)}
                          onChange={(v) => {
                            const n = Number(v);
                            prescribe(e.id, {
                              sets: v.trim() === "" || Number.isNaN(n) ? undefined : n,
                            });
                          }}
                          numeric
                        />
                        <Prescribe
                          label={`${e.name} reps`}
                          placeholder="Reps"
                          value={lift.reps ?? ""}
                          onChange={(v) => prescribe(e.id, { reps: v.trim() || undefined })}
                        />
                        <Prescribe
                          label={`${e.name} load`}
                          placeholder="Load"
                          value={lift.load ?? ""}
                          onChange={(v) => prescribe(e.id, { load: v.trim() || undefined })}
                          wide
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises"
              aria-label="Search exercises"
              className="mt-4 block min-h-[44px] w-full rounded-md bg-field px-3 t-body text-ink outline-none placeholder:text-ink-3"
            />

            <div className="mt-3 group-list bg-wash">
              {library.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  // A preset has no record behind it yet, so picking it makes
                  // one. Its id here is the library's, never the store's.
                  onClick={() => add(e.preset ? addExercise(e.name, e.type).id : e.id)}
                  className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
                >
                  <span className="min-w-0 truncate t-body text-ink">{e.name}</span>
                  <span aria-hidden="true" className="shrink-0 t-label font-semibold text-ink-3">
                    +
                  </span>
                </button>
              ))}

              {/* The same offer the log sheet's picker makes, which this one
                  never had: planning a workout around a lift you have not done
                  before is the ordinary case, and the only answer here was to
                  abandon the card, log a set of it somewhere, and come back. */}
              {canCreate && (
                <button
                  type="button"
                  onClick={create}
                  className={`group-row w-full text-left ${
                    library.length > 0 ? "group-row-sep" : ""
                  }`}
                >
                  <span className="min-w-0 truncate t-body font-medium t-action">
                    Add &ldquo;{typed}&rdquo;
                  </span>
                  <span className="shrink-0 t-label t-action">New</span>
                </button>
              )}

              {library.length === 0 && !canCreate && (
                <div className="group-row">
                  <span className="t-body text-ink-2">
                    {typed ? "Already chosen" : "Everything is chosen"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {kind === "workout" && templates.length > 0 && (
          <div className="pt-3">
            <div className="group-header">
              <h3 className="t-caption">From a template</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template.id)}
                  className="min-h-[44px] rounded-md bg-wash px-3 t-label font-medium text-ink"
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "workout" && picked.length > 0 && (
          <label className="flex min-h-[44px] items-center gap-3 pt-3">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
              className="h-5 w-5 accent-white"
            />
            <span className="t-label text-ink-2">Also save as a template</span>
          </label>
        )}

        <div className="mt-5 flex shrink-0 items-center gap-2">
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

function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        on ? "bg-ink" : "bg-paper ring-1 ring-inset ring-ink-3"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
          on ? "left-6 bg-paper" : "left-1 bg-ink-3"
        }`}
      />
    </button>
  );
}

/** One prescription field. Unlabelled on screen: the placeholder is the label. */
function Prescribe({
  label,
  placeholder,
  value,
  onChange,
  numeric,
  wide,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode={numeric ? "numeric" : "text"}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className={`min-h-[38px] rounded-md bg-field px-2 t-label text-ink outline-none placeholder:text-ink-3 ${
        wide ? "flex-[2]" : "flex-1"
      }`}
    />
  );
}
