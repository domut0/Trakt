import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { kindOf } from "../lib/planning";
import { usePlanLocked } from "../lib/plan-lock";
import { useStore, type SplitSlot } from "../lib/store";
import { ArrowDown, ArrowUp, Repeat } from "./icons";

/** Pixels of horizontal travel before a press commits to being a swipe. */
const SLOP = 8;
/** How far right you have to pull before the delete button latches open. */
const SWIPE_OPEN = 72;

type Gesture = "undecided" | "swipe" | "scroll";

/**
 * The workout split, as a list of cards you can rearrange.
 *
 * WHAT A CARD DOES IS BUTTONS, NOT GESTURES. This list has twice been the place
 * where a hidden gesture stood in for a control, and twice it has been wrong:
 * drag-to-reorder became an arrow pair, and now long-press-for-"do this next"
 * becomes a row of actions that opens on a tap. Holding a card down and waiting
 * 450ms to find out whether a menu appears is not something anybody reaches for
 * on purpose, and it was hiding the most-used action on this screen behind the
 * least discoverable gesture on it.
 *
 * So a tap opens EDIT CARD / DO THIS TODAY / DELETE underneath the card, and
 * nothing here is reachable only by holding something down.
 *
 * The one gesture left is the swipe, which keeps its own delete: swiping a row
 * to bin it is a platform idiom rather than an invention, and it costs one
 * movement where the action row costs two.
 */
export function SplitCardList({ onEdit }: { onEdit: (slot: SplitSlot) => void }) {
  const slots = useStore((s) => s.slots);
  // A coach-managed plan has no actions on it, so a tap goes straight to
  // `onEdit` and the caller opens it to be read. Reading is not a write.
  const locked = usePlanLocked();
  const exercises = useStore((s) => s.exercises);
  const deleteSplitCard = useStore((s) => s.deleteSplitCard);
  const moveSplitCard = useStore((s) => s.moveSplitCard);
  const setNextCard = useStore((s) => s.setNextCard);
  const nextCard = useStore((s) => s.nextCard());

  const ordered = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);

  /** The card whose swipe-delete is latched open. */
  const [swipedId, setSwipedId] = useState<string | null>(null);
  /** The card whose action row is open. At most one, so opening a second closes
   *  the first rather than leaving the list full of expanded rows. */
  const [actionsId, setActionsId] = useState<string | null>(null);

  const start = useRef<{ x: number; y: number; id: string } | null>(null);
  const gesture = useRef<Gesture>("undecided");

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    start.current = { x: e.clientX, y: e.clientY, id };
    gesture.current = "undecided";
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current || gesture.current !== "undecided") return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
    // Whichever axis moved further wins, once, and keeps the pointer. A vertical
    // win means the page is scrolling and this list wants no part of it -
    // touch-pan-y below is what actually lets that through.
    gesture.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;

    if (gesture.current === "scroll") return;

    if (gesture.current === "swipe") {
      // Nothing to reveal on a card that cannot be deleted.
      if (locked) return;
      // Right only. Pulling right reveals a delete button on the LEFT, so the
      // control appears from the side the thumb came from.
      const dx = e.clientX - s.x;
      setSwipedId(dx > SWIPE_OPEN ? s.id : null);
      return;
    }

    // A tap on a locked card opens the card itself. There are no actions to
    // toggle, and the thing the tap is reaching for is what is on it.
    if (locked) {
      const tapped = slots.find((sl) => sl.id === s.id);
      if (tapped) onEdit(tapped);
      return;
    }

    // A tap. It shuts a latched swipe if there is one, otherwise it toggles
    // this card's actions.
    if (swipedId === s.id) {
      setSwipedId(null);
      return;
    }
    setSwipedId(null);
    setActionsId((current) => (current === s.id ? null : s.id));
  };

  return (
    <div className="group-list">
      {ordered.map((slot, i) => {
        const kind = kindOf(slot);
        const isNext = nextCard?.id === slot.id;
        const isSwiped = swipedId === slot.id;
        const showActions = actionsId === slot.id && !locked;
        const lifts = (slot.plannedLifts ?? [])
          .map((lift) => exercises.find((e) => e.id === lift.exerciseId)?.name)
          .filter((n): n is string => n !== undefined);

        // The cardio line, said the way it is prescribed: what, then how much
        // of it, with whatever was not prescribed simply absent.
        const cardio = slot.plannedCardio;
        const cardioName = cardio
          ? exercises.find((e) => e.id === cardio.exerciseId)?.name
          : undefined;
        const cardioLine = cardioName
          ? [
              cardioName,
              cardio?.durationMinutes === undefined ? undefined : `${cardio.durationMinutes} min`,
              cardio?.distance === undefined ? undefined : `${cardio.distance}`,
            ]
              .filter(Boolean)
              .join(", ")
          : undefined;

        return (
          <div key={slot.id}>
            <div className="relative overflow-hidden">
              {/* Rendered only while open. Left mounted, its red showed through
                  the card's own rounded corners on the first and last rows,
                  which is the same class of bug as a transparent row over an
                  underlay - a shape behind another shape has to respect its
                  edges. */}
              {isSwiped && (
                <button
                  type="button"
                  aria-label={`Delete ${slot.name}`}
                  onClick={() => {
                    deleteSplitCard(slot.id);
                    setSwipedId(null);
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
                  start.current = null;
                }}
                // bg is load-bearing: this slides over the delete button, and a
                // transparent row would let it print through at rest.
                className={`group-row relative touch-pan-y select-none ${
                  i === 0 ? "" : "group-row-sep"
                } ${isNext ? "bg-wash" : "bg-surface"}`}
                style={{
                  transform: isSwiped ? "translateX(80px)" : "translateX(0)",
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
                    {/* A cardio card's line IS the card; on a workout card it
                        sits under the lifts as the finisher it is. */}
                    {(kind === "cardio" || (kind === "workout" && cardioLine)) && (
                      <span className="block truncate t-label text-ink-2">
                        {cardioLine ?? "No activity chosen"}
                      </span>
                    )}
                  </span>
                )}

                {!locked && (
                  <Reorder
                    label={slot.name}
                    index={i}
                    count={ordered.length}
                    onMove={(to) => moveSplitCard(slot.id, to)}
                  />
                )}
              </div>
            </div>

            {showActions && (
              <div className="flex items-stretch gap-2 px-3 pb-3 pt-1">
                <ActionButton
                  onClick={() => {
                    setActionsId(null);
                    onEdit(slot);
                  }}
                >
                  Edit card
                </ActionButton>

                {/* A repeat is not a day, so there is no day to do it on. */}
                {kind !== "repeat" && (
                  <ActionButton
                    onClick={() => {
                      setNextCard(slot.id);
                      setActionsId(null);
                    }}
                    disabled={isNext}
                  >
                    Do this today
                  </ActionButton>
                )}

                <ActionButton signal onClick={() => deleteSplitCard(slot.id)}>
                  Delete
                </ActionButton>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  signal,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  signal?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] flex-1 rounded-md bg-wash px-2 t-label font-semibold disabled:opacity-40 ${
        signal ? "text-signal" : "text-ink"
      }`}
    >
      {children}
    </button>
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
 * `stopPropagation` on pointerdown keeps the row's swipe and tap from arming
 * under a press that was aimed at an arrow.
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
