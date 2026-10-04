import { useEffect, useMemo, useRef, useState } from "react";
import { seedExercises } from "../lib/exercise-library";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { kindOf, type SplitCardKind } from "../lib/planning";
import { useStore, type Exercise, type PlannedLift, type SplitSlot } from "../lib/store";
import { Close } from "./icons";
import { Reorder } from "./SplitCardList";

/**
 * One card in the workout split.
 *
 * All fields share one scroll area, so adding a finisher cannot squeeze the
 * chosen lifts out of view. Save and Cancel remain outside that scroll area.
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

  const containerRef = useRef<HTMLDivElement | null>(null);

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

  useDialogFocus(open, containerRef);

  const liftable = useMemo(() => exercises.filter((e) => e.type !== "cardio"), [exercises]);

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

  const prescribe = (id: string, patch: Partial<Omit<PlannedLift, "exerciseId">>) =>
    setPicked((p) => p.map((lift) => (lift.exerciseId === id ? { ...lift, ...patch } : lift)));

  const typed = query.trim();
  const canCreate =
    typed.length > 0 &&
    !exercises.some((e) => e.name.toLowerCase() === typed.toLowerCase()) &&
    !seedExercises.some((e) => e.name.toLowerCase() === typed.toLowerCase());

  const create = () => {
    add(addExercise(typed, "accessory").id);
    setQuery("");
  };
  const remove = (id: string) => setPicked((p) => p.filter((lift) => lift.exerciseId !== id));

  const move = (from: number, to: number) =>
    setPicked((p) => {
      if (to < 0 || to >= p.length) return p;
      const next = [...p];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const setToggle = (which: "rest" | "repeat" | "cardio", on: boolean) =>
    setKind(on ? which : "workout");

  const cardioOptions = exercises.filter((e) => e.type === "cardio");

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
    if (saveAsTemplate && target) saveTemplateFrom(target.id, name);
    onClose();
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    // Like choosing a lift from the library, resolve names now but keep the
    // card itself a draft until Save. Cancel must not replace a prescription
    // or leave behind a new card created only to preview a template.
    setPicked(
      template.lifts.map(({ name: liftName, ...prescription }) => {
        const key = liftName.trim().toLowerCase();
        const exercise =
          useStore.getState().exercises.find((item) => item.name.trim().toLowerCase() === key) ??
          addExercise(liftName.trim(), "accessory");
        return { exerciseId: exercise.id, ...prescription };
      }),
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col justify-end bg-black/25 anim-backdrop"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={slot ? "Edit card" : "New card"}
        className="flex h-[100dvh] max-h-[100dvh] w-full flex-col bg-surface anim-sheet outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact persistent header */}
        <div
          className="shrink-0 flex items-center justify-between border-b border-wash px-4 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
        >
          <h2 className="t-heading text-ink">{slot ? "Edit card" : "New card"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2"
          >
            <Close size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          <div className="group-list bg-wash">
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
                  className="min-h-[44px] min-w-0 flex-1 rounded-md bg-field px-3 text-right t-body text-ink outline-none placeholder:text-ink-3"
                />
              </div>
            )}

            <div className={`group-row ${kind !== "repeat" ? "group-row-sep" : ""}`}>
              <span className="t-body font-medium text-ink">Rest day</span>
              <Switch
                on={kind === "rest"}
                label="Rest day"
                onChange={(v) => setToggle("rest", v)}
              />
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
            <div>
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
                    className="min-h-[44px] rounded-md bg-field px-2 text-right t-body text-ink outline-none"
                  >
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
                        className="min-h-[44px] w-24 rounded-md bg-field px-2 text-right t-body text-ink outline-none placeholder:text-ink-3"
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
                        className="min-h-[44px] w-24 rounded-md bg-field px-2 text-right t-body text-ink outline-none placeholder:text-ink-3"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {kind === "repeat" && (
            <p className="t-label text-ink-2">
              Sends the split back to the first card instead of being a day of its own
            </p>
          )}

          {kind === "workout" && (
            <div>
              {chosen.length > 0 && (
                <div>
                  <div className="group-header">
                    <h3 className="t-caption">Chosen</h3>
                  </div>
                  <div className="group-list bg-wash">
                    {chosen.map(({ lift, exercise: e }, i) => (
                      <div key={e.id} className={`px-4 py-2 ${i === 0 ? "" : "group-row-sep"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 break-words t-body text-ink">
                            {e.name}
                          </span>
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
                              className="flex h-11 w-11 items-center justify-center text-ink-3"
                            >
                              <Close size={16} />
                            </button>
                          </span>
                        </div>
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
                    onClick={() => add(e.preset ? addExercise(e.name, e.type).id : e.id)}
                    className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
                  >
                    <span className="min-w-0 flex-1 break-words t-body text-ink">{e.name}</span>
                    <span aria-hidden="true" className="shrink-0 t-label font-semibold text-ink-3">
                      +
                    </span>
                  </button>
                ))}

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
            <div>
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
            <label className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                checked={saveAsTemplate}
                onChange={(e) => setSaveAsTemplate(e.target.checked)}
                className="h-5 w-5 accent-white"
              />
              <span className="t-label text-ink-2">Also save as a template</span>
            </label>
          )}
        </div>

        <div
          className="shrink-0 border-t border-wash bg-surface px-4 pt-3 flex items-center gap-2"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
          >
            Cancel
          </button>
          <button
            type="button"
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
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
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
    <label className={`min-w-0 ${wide ? "flex-[2]" : "flex-1"}`}>
      <span className="mb-1 block t-caption text-ink-2">{placeholder}</span>
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
        className="min-h-[44px] w-full rounded-md bg-field px-2 t-body text-ink outline-none placeholder:text-ink-3"
      />
    </label>
  );
}
