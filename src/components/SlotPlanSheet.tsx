import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { kindOf, type SplitCardKind } from "../lib/planning";
import { useStore, type Exercise, type SplitSlot } from "../lib/store";

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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? liftable.filter((e) => e.name.toLowerCase().includes(q)) : liftable;
    // Chosen lifts first, in the order they were chosen, so the list does not
    // reshuffle under a thumb as things are ticked.
    const chosen = picked
      .map((id) => pool.find((e) => e.id === id))
      .filter((e): e is Exercise => e !== undefined);
    const rest = pool.filter((e) => !picked.includes(e.id)).slice(0, 40);
    return [...chosen, ...rest];
  }, [liftable, query, picked]);

  if (!open || typeof document === "undefined") return null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /** Both toggles off means a normal workout card, so turning one on turns the
   *  other off rather than producing a card that is two things. */
  const setToggle = (which: "rest" | "repeat", on: boolean) => setKind(on ? which : "workout");

  const save = () => {
    const target = slot ?? addSplitCard({ name, kind });
    if (slot) updateSplitCard(slot.id, { name, kind });
    if (kind === "workout") setSlotExercises(target.id, picked);
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
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises"
              aria-label="Search exercises"
              className="mt-4 min-h-[44px] shrink-0 rounded-md bg-wash px-3 t-body text-ink outline-none placeholder:text-ink-3"
            />

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto group-list bg-wash">
              {results.map((e, i) => {
                const on = picked.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    aria-pressed={on}
                    className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
                  >
                    <span className="min-w-0 truncate t-body text-ink">{e.name}</span>
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm t-label font-semibold ${
                        on ? "bg-ink text-paper" : "text-transparent ring-1 ring-inset ring-ink-3"
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </>
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
