import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore, type SplitSlot } from "../lib/store";

/**
 * The lifts one slot is for.
 *
 * A slot rather than a weekday, because the rotation this plans has no weekdays
 * in it: UL×infinity advances when you train. Picking the lifts for "Upper" once
 * is what a plan is here, and it holds for every Upper you ever do.
 *
 * Cardio is filtered out for the same reason the log sheet filters it: a cardio
 * bout produces no sets, so preloading one would open the workout onto an
 * exercise the set logger cannot log.
 */
export function SlotPlanSheet({
  slot,
  open,
  onClose,
}: {
  slot: SplitSlot | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const setSlotExercises = useStore((s) => s.setSlotExercises);

  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
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
      .filter((e): e is (typeof pool)[number] => e !== undefined);
    const rest = pool.filter((e) => !picked.includes(e.id)).slice(0, 40);
    return [...chosen, ...rest];
  }, [liftable, query, picked]);

  if (!open || !slot || typeof document === "undefined") return null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

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

        <h2 className="shrink-0 t-heading text-ink">{slot.name}</h2>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          className="mt-3 min-h-[44px] shrink-0 rounded-md bg-wash px-3 t-body text-ink outline-none placeholder:text-ink-3"
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

        <div className="mt-5 flex shrink-0 items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setSlotExercises(slot.id, picked);
              onClose();
            }}
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
