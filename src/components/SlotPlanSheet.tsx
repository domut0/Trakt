import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { kindOf, type SplitCardKind } from "../lib/planning";
import { useStore, type Exercise, type SplitSlot } from "../lib/store";
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
  const setSlotExercises = useStore((s) => s.setSlotExercises);
  const addExercise = useStore((s) => s.addExercise);
  const addSplitCard = useStore((s) => s.addSplitCard);
  const updateSplitCard = useStore((s) => s.updateSplitCard);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SplitCardKind>("workout");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(slot?.name ?? "");
    setKind(slot ? kindOf(slot) : "workout");
    setPicked(slot?.plannedExerciseIds ?? []);
    setQuery("");
  }, [open, slot]);

  useSheetDismiss(open, onClose);

  const liftable = useMemo(() => exercises.filter((e) => e.type !== "cardio"), [exercises]);

  /** The chosen lifts, resolved and in the order the workout will open them.
   *  Ids whose exercise has since been deleted drop out here rather than
   *  rendering a blank row. */
  const chosen = useMemo(
    () =>
      picked
        .map((id) => liftable.find((e) => e.id === id))
        .filter((e): e is Exercise => e !== undefined),
    [liftable, picked],
  );

  /** Everything not already chosen, filtered by the search box. */
  const library = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = liftable.filter((e) => !picked.includes(e.id));
    return (q ? pool.filter((e) => e.name.toLowerCase().includes(q)) : pool).slice(0, 40);
  }, [liftable, query, picked]);

  if (!open || typeof document === "undefined") return null;

  const add = (id: string) => setPicked((p) => (p.includes(id) ? p : [...p, id]));

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
    typed.length > 0 && !exercises.some((e) => e.name.toLowerCase() === typed.toLowerCase());

  const create = () => {
    // Accessory, matching the log sheet's picker. It is the type that assumes
    // least, and the exercise page is where a type gets corrected.
    add(addExercise(typed, "accessory").id);
    setQuery("");
  };
  const remove = (id: string) => setPicked((p) => p.filter((x) => x !== id));

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

  /** Both toggles off means a normal workout card, so turning one on turns the
   *  other off rather than producing a card that is two things. */
  const setToggle = (which: "rest" | "repeat", on: boolean) => setKind(on ? which : "workout");

  const save = () => {
    const target = slot ?? addSplitCard({ name, kind });
    if (slot) updateSplitCard(slot.id, { name, kind });
    if (kind === "workout" && target) setSlotExercises(target.id, picked);
    onClose();
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
            <span className="t-body font-medium text-ink">Repeat</span>
            <Switch
              on={kind === "repeat"}
              label="Repeat"
              onChange={(v) => setToggle("repeat", v)}
            />
          </div>
        </div>

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
                  {chosen.map((e, i) => (
                    <div key={e.id} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
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
              className="mt-4 block min-h-[44px] w-full rounded-md bg-wash px-3 t-body text-ink outline-none placeholder:text-ink-3"
            />

            <div className="mt-3 group-list bg-wash">
              {library.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => add(e.id)}
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
