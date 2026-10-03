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
 * A row tap reads the workout. Options, reorder buttons, and swipe deletion
 * keep management separate from reading, without relying on a long press.
 */
export function SplitCardList({ onEdit }: { onEdit: (slot: SplitSlot) => void }) {
  const slots = useStore((s) => s.slots);
  const locked = usePlanLocked();
  const exercises = useStore((s) => s.exercises);
  const deleteSplitCard = useStore((s) => s.deleteSplitCard);
  const moveSplitCard = useStore((s) => s.moveSplitCard);
  const setNextCard = useStore((s) => s.setNextCard);
  const nextCard = useStore((s) => s.nextCard());

  const ordered = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);

  /** The card whose swipe-delete is latched open. */
  const [swipedId, setSwipedId] = useState<string | null>(null);
  /** The card whose action row is open. At most one. */
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
    gesture.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;

    if (gesture.current === "scroll") return;

    if (gesture.current === "swipe") {
      if (locked) return;
      const dx = e.clientX - s.x;
      setSwipedId(dx > SWIPE_OPEN ? s.id : null);
      return;
    }
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
              {isSwiped && (
                <button
                  type="button"
                  aria-label={`Delete ${slot.name}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
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
                className={`group-row relative touch-pan-y select-none ${
                  i === 0 ? "" : "group-row-sep"
                } ${isNext ? "bg-wash" : "bg-surface"}`}
                style={{
                  transform: isSwiped ? "translateX(80px)" : "translateX(0)",
                  transition: "transform 160ms ease",
                }}
              >
                <button
                  type="button"
                  aria-label={`View ${slot.name}`}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center text-left"
                  onClick={(event) => {
                    if (event.detail > 0 && gesture.current !== "undecided") return;
                    if (isSwiped) {
                      setSwipedId(null);
                      return;
                    }
                    setSwipedId(null);
                    setActionsId(null);
                    onEdit(slot);
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
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate t-body font-medium text-ink">{slot.name}</span>
                        {isNext && <span className="shrink-0 t-label text-ink-3">next</span>}
                      </span>
                      {kind === "workout" && (
                        <span className="block truncate t-label text-ink-2">
                          {lifts.length > 0 ? lifts.join(" · ") : "No lifts chosen"}
                        </span>
                      )}
                      {(kind === "cardio" || (kind === "workout" && cardioLine)) && (
                        <span className="block truncate t-label text-ink-2">
                          {cardioLine ?? "No activity chosen"}
                        </span>
                      )}
                    </span>
                  )}
                </button>

                {!locked && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-label={`Options for ${slot.name}`}
                      aria-expanded={showActions}
                      aria-controls={`card-options-${slot.id}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSwipedId(null);
                        setActionsId((current) => (current === slot.id ? null : slot.id));
                      }}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2 t-label font-bold"
                    >
                      <svg
                        aria-hidden="true"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <circle cx="5" cy="12" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="19" cy="12" r="1.5" />
                      </svg>
                    </button>
                    <Reorder
                      label={slot.name}
                      index={i}
                      count={ordered.length}
                      onMove={(to) => moveSplitCard(slot.id, to)}
                    />
                  </div>
                )}
              </div>
            </div>

            {showActions && (
              <div
                id={`card-options-${slot.id}`}
                className="flex items-stretch gap-2 px-3 pb-3 pt-1"
              >
                <ActionButton
                  onClick={() => {
                    setActionsId(null);
                    onEdit(slot);
                  }}
                >
                  View workout
                </ActionButton>

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

                <ActionButton
                  signal
                  onClick={() => {
                    setActionsId(null);
                    deleteSplitCard(slot.id);
                  }}
                >
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
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`min-h-[44px] flex-1 rounded-md bg-wash px-2 t-label font-semibold disabled:opacity-40 ${
        signal ? "text-signal" : "text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Reorder({
  label,
  index,
  count,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const btn =
    "flex h-11 w-11 items-center justify-center disabled:opacity-30 disabled:pointer-events-none";
  return (
    <span className="-my-1 flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
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
