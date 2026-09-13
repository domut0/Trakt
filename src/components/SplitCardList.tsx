import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { kindOf } from "../lib/planning";
import { useStore, type SplitSlot } from "../lib/store";
import { ArrowDown, ArrowUp, Repeat } from "./icons";

/** Pixels of horizontal travel before a press commits to being a swipe. */
const SLOP = 8;
/** How far right you have to pull before the delete button latches open. */
const SWIPE_OPEN = 72;
/** Milliseconds of stillness that turns a press into a long-press. */
const HOLD_MS = 450;

type Gesture = "undecided" | "swipe" | "scroll";

/**
 * The workout split, as a list of cards you can rearrange.
 *
 * REORDERING IS BUTTONS, NOT A DRAG. Drag-to-reorder was the third gesture on
 * these cards, and three gestures on one element is one too many: a long press
 * that drifted became a drag, a drag that drifted became a swipe, and the only
 * way to find out which you had performed was to watch what happened. An arrow
 * pair on the right of each card says what it does, needs no threshold, and is
 * the one control here that works with a keyboard.
 *
 * What is left is two gestures with nothing in common. A horizontal pull past
 * {SLOP} is a swipe and opens Delete; a press that has not moved at all by
 * {HOLD_MS} is a long-press and opens "Do this next". Any vertical movement
 * hands the pointer back to the page so the list scrolls normally.
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

  const start = useRef<{ x: number; y: number; id: string } | null>(null);
  const gesture = useRef<Gesture>("undecided");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!start.current || gesture.current !== "undecided") return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
    clearHold();
    // Whichever axis moved further wins, once, and keeps the pointer. A
    // vertical win means the page is scrolling and this list wants no part of
    // it - touch-pan-y below is what actually lets that through.
    gesture.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    clearHold();
    const s = start.current;
    start.current = null;
    if (!s) return;

    if (gesture.current === "scroll") return;

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
        const lifts = (slot.plannedExerciseIds ?? [])
          .map((id) => exercises.find((e) => e.id === id)?.name)
          .filter((n): n is string => n !== undefined);

        return (
          <div key={slot.id} className="relative overflow-hidden">
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
              }}
              // bg is load-bearing: this slides over the delete button, and a
              // transparent row would let it print through at rest.
              className={`group-row relative touch-pan-y select-none ${
                i === 0 ? "" : "group-row-sep"
              } ${isNext ? "bg-wash" : "bg-surface"}`}
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

              <Reorder
                label={slot.name}
                index={i}
                count={ordered.length}
                onMove={(to) => moveSplitCard(slot.id, to)}
              />
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

/**
 * The arrow pair that moves one row within its list.
 *
 * Stacked rather than side by side, and 36x22 each rather than 44x44. Two 44px
 * squares is 88px of a 448px row spent on a control used once per card, and the
 * pair as a whole clears 44px in the axis that matters - the one your thumb
 * travels along to go from "up" to "down". Each arrow is disabled at the end it
 * cannot move towards, so the control also tells you where in the cycle you are.
 *
 * `stopPropagation` on pointerdown keeps the row's swipe and long-press from
 * arming under a press that was aimed at an arrow.
 */
export function Reorder({
  label,
  index,
  count,
  onMove,
}: {
  /** What is being moved, for the screen reader. */
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const btn =
    "flex h-[22px] w-9 items-center justify-center disabled:opacity-30 disabled:pointer-events-none";
  return (
    <span
      className="-my-1 flex shrink-0 flex-col items-center"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className={`${btn} text-ink-2`}
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className={`${btn} text-ink-2`}
      >
        <ArrowDown size={16} />
      </button>
    </span>
  );
}
