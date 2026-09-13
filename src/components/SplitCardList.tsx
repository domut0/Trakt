import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { kindOf } from "../lib/planning";
import { useStore, type SplitSlot } from "../lib/store";
import { Repeat } from "./icons";

/** Pixels of travel before a gesture commits to being a drag or a swipe. */
const SLOP = 8;
/** How far right you have to pull before the delete button latches open. */
const SWIPE_OPEN = 72;
/** Milliseconds of stillness that turns a press into a long-press. */
const HOLD_MS = 450;

type Gesture = "undecided" | "swipe" | "drag";

/**
 * The workout split, as a list of cards you can rearrange.
 *
 * Three gestures share one element, which is the fiddly part, so the arbitration
 * is explicit rather than emergent: the first {SLOP}px of travel decides whether
 * this is a horizontal swipe or a vertical drag, and a press that has not moved
 * at all by {HOLD_MS} becomes a long-press instead. Once a gesture is chosen it
 * keeps the pointer until release, so a sloppy diagonal cannot end up doing two
 * things at once.
 */
export function SplitCardList({ onEdit }: { onEdit: (slot: SplitSlot) => void }) {
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const deleteSplitCard = useStore((s) => s.deleteSplitCard);
  const moveSplitCard = useStore((s) => s.moveSplitCard);
  const setNextCard = useStore((s) => s.setNextCard);
  const nextCard = useStore((s) => s.nextCard());

  const ordered = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);

  const [openId, setOpenId] = useState<string | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const start = useRef<{ x: number; y: number; id: string } | null>(null);
  const gesture = useRef<Gesture>("undecided");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowH = useRef(64);

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    start.current = { x: e.clientX, y: e.clientY, id };
    gesture.current = "undecided";
    clearHold();
    holdTimer.current = setTimeout(() => {
      if (gesture.current === "undecided") {
        setHeldId(id);
        setOpenId(null);
      }
    }, HOLD_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (gesture.current === "undecided") {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      clearHold();
      // Whichever axis moved further wins, once, and keeps the pointer.
      gesture.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "drag";
      if (gesture.current === "drag") {
        setDragId(start.current.id);
        setOpenId(null);
      }
    }

    if (gesture.current === "drag") {
      const from = ordered.findIndex((s) => s.id === start.current!.id);
      const target = Math.max(
        0,
        Math.min(ordered.length - 1, from + Math.round(dy / rowH.current)),
      );
      setDragOver(target);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    clearHold();
    const s = start.current;
    start.current = null;
    if (!s) return;

    if (gesture.current === "drag") {
      if (dragOver !== null) moveSplitCard(s.id, dragOver);
      setDragId(null);
      setDragOver(null);
      return;
    }

    if (gesture.current === "swipe") {
      // Right only. Pulling right reveals a delete button on the LEFT, so the
      // control appears from the side the thumb came from.
      const dx = e.clientX - s.x;
      setOpenId(dx > SWIPE_OPEN ? s.id : null);
      return;
    }

    // A tap that never moved and never became a hold.
    if (heldId) return;
    if (openId === s.id) {
      setOpenId(null);
      return;
    }
    const slot = ordered.find((c) => c.id === s.id);
    if (slot) onEdit(slot);
  };

  return (
    <div className="group-list" onPointerLeave={() => setHeldId(null)}>
      {ordered.map((slot, i) => {
        const kind = kindOf(slot);
        const isNext = nextCard?.id === slot.id;
        const isOpen = openId === slot.id;
        const isDragging = dragId === slot.id;
        const lifts = (slot.plannedExerciseIds ?? [])
          .map((id) => exercises.find((e) => e.id === id)?.name)
          .filter((n): n is string => n !== undefined);

        return (
          <div
            key={slot.id}
            ref={(el) => {
              if (el && i === 0) rowH.current = el.offsetHeight || 64;
            }}
            className={`relative overflow-hidden ${
              dragOver === i && dragId && !isDragging ? "border-t border-ink-3" : ""
            }`}
          >
            {/* Rendered only while open. Left mounted, its red showed through
                the card's own rounded corners on the first and last rows, which
                is the same class of bug as a transparent row over an underlay -
                a shape behind another shape has to respect its edges. */}
            {isOpen && (
              <button
                type="button"
                aria-label={`Delete ${slot.name}`}
                onClick={() => {
                  deleteSplitCard(slot.id);
                  setOpenId(null);
                }}
                className="absolute inset-y-0 left-0 flex w-20 items-center justify-center bg-signal t-label font-semibold text-paper"
              >
                Delete
              </button>
            )}

            <div
              onPointerDown={(e) => onPointerDown(e, slot.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                clearHold();
                start.current = null;
                setDragId(null);
                setDragOver(null);
              }}
              // bg is load-bearing: this slides over the delete button, and a
              // transparent row would let it print through at rest.
              className={`group-row relative touch-pan-y select-none ${
                i === 0 ? "" : "group-row-sep"
              } ${isNext ? "bg-wash" : "bg-surface"} ${isDragging ? "opacity-60" : ""}`}
              style={{
                transform: isOpen ? "translateX(80px)" : "translateX(0)",
                transition: "transform 160ms ease",
              }}
            >
              {kind === "repeat" ? (
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-wash text-ink-2"
                  >
                    <Repeat size={16} />
                  </span>
                  <span className="t-label text-ink-2">Back to the top</span>
                </span>
              ) : (
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate t-body font-medium text-ink">{slot.name}</span>
                    {isNext && <span className="shrink-0 t-label text-ink-3">next</span>}
                  </span>
                  {kind === "workout" && (
                    <span className="block truncate t-label text-ink-2">
                      {lifts.length > 0 ? lifts.join(" · ") : "No lifts chosen"}
                    </span>
                  )}
                </span>
              )}
            </div>

            {/* The long-press menu, beside the card it acts on. */}
            {heldId === slot.id && kind !== "repeat" && (
              <div className="absolute inset-y-0 right-3 z-10 flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    setNextCard(slot.id);
                    setHeldId(null);
                  }}
                  className="min-h-[44px] rounded-md bg-ink px-4 t-label font-semibold text-paper"
                >
                  Do this next
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
