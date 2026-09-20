import { useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type SplitSlot } from "../lib/store";
import { kindOf } from "../lib/planning";
import { Chevron, Plus } from "./icons";
import { usePlanLocked } from "../lib/plan-lock";

/**
 * The week, as seven days you put cards on.
 *
 * The default way to plan, and the one most people mean by "my programme":
 * Upper on Monday, Lower on Wednesday. The rotation - cards consumed in a
 * cycle, with repeats - is the other mode, and it is what an Upper/Lower
 * ×infinity split needs, because that advances when you train rather than when
 * the date changes.
 *
 * A day holds one card or nothing. A day with nothing on it is a day with
 * nothing on it: nothing rolls forward, because a plan that slides a missed
 * Monday into Tuesday is the rotation again, wearing a calendar's clothes.
 */

const DAYS = [
  { index: 1, label: "Monday" },
  { index: 2, label: "Tuesday" },
  { index: 3, label: "Wednesday" },
  { index: 4, label: "Thursday" },
  { index: 5, label: "Friday" },
  { index: 6, label: "Saturday" },
  { index: 0, label: "Sunday" },
] as const;

export function WeekPlanner({ onEdit }: { onEdit: (slot: SplitSlot) => void }) {
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const setCardWeekday = useStore((s) => s.setCardWeekday);
  const locked = usePlanLocked();
  const [assigning, setAssigning] = useState<number | undefined>();

  const today = new Date().getDay();
  const onDay = (weekday: number) => slots.find((sl) => sl.weekday === weekday);
  const unassigned = slots.filter((sl) => sl.weekday === undefined && kindOf(sl) !== "repeat");

  /** The lifts on a card, as names, for the line under the card's own name. */
  const liftsOf = (slot: SplitSlot) =>
    (slot.plannedLifts ?? [])
      .map((lift) => exercises.find((e) => e.id === lift.exerciseId)?.name)
      .filter((name): name is string => name !== undefined)
      .join(", ");

  return (
    <section className="px-4 section-gap">
      <div className="group-header">
        <h2 className="t-caption">Week</h2>
      </div>

      <div className="group-list">
        {DAYS.map(({ index, label }, i) => {
          const card = onDay(index);
          const isToday = index === today;
          return (
            <div key={index} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
              <button
                type="button"
                disabled={locked}
                onClick={() => (card ? onEdit(card) : setAssigning(index))}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {/* The day you are on is inked, the same mark the week strip
                    uses. One vocabulary for "you are here". */}
                <span
                  className={`w-24 shrink-0 t-label ${isToday ? "font-semibold text-ink" : "text-ink-2"}`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1">
                  {card ? (
                    <>
                      <span className="block truncate t-body text-ink">
                        {kindOf(card) === "rest" ? "Rest" : card.name}
                      </span>
                      {liftsOf(card) && (
                        <span className="block truncate t-label text-ink-2">{liftsOf(card)}</span>
                      )}
                    </>
                  ) : (
                    <span className="block t-body text-ink-3">{locked ? "—" : "Add"}</span>
                  )}
                </span>
              </button>
              {card && !locked && (
                <button
                  type="button"
                  aria-label={`Clear ${label}`}
                  onClick={() => setCardWeekday(card.id, undefined)}
                  className="ml-2 min-h-[44px] shrink-0 px-2 t-label text-ink-2"
                >
                  Clear
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Cards not on any day. They are not deleted by being off the week -- a
          card you train some weeks and not others is an ordinary thing. */}
      {unassigned.length > 0 && (
        <>
          <div className="group-header pt-4">
            <h3 className="t-caption">Not this week</h3>
          </div>
          <div className="group-list">
            {unassigned.map((slot, i) => (
              <button
                key={slot.id}
                type="button"
                disabled={locked}
                onClick={() => onEdit(slot)}
                className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate t-body text-ink">{slot.name}</span>
                  {liftsOf(slot) && (
                    <span className="block truncate t-label text-ink-2">{liftsOf(slot)}</span>
                  )}
                </span>
                <Chevron className="shrink-0 text-ink-2" size={16} />
              </button>
            ))}
          </div>
        </>
      )}

      {assigning !== undefined && (
        <AssignSheet
          weekday={assigning}
          onClose={() => setAssigning(undefined)}
          onPick={(slotId) => {
            setCardWeekday(slotId, assigning);
            setAssigning(undefined);
          }}
        />
      )}
    </section>
  );
}

/**
 * What goes on this day: any card that exists, or a new one.
 *
 * A list rather than a drag target because the list is what works one-handed on
 * a phone; dragging a card onto a day is the gesture people describe, and the
 * one that goes wrong in a scrolling view.
 */
function AssignSheet({
  weekday,
  onClose,
  onPick,
}: {
  weekday: number;
  onClose: () => void;
  onPick: (slotId: string) => void;
}) {
  const slots = useStore((s) => s.slots);
  const addSplitCard = useStore((s) => s.addSplitCard);
  const label = DAYS.find((d) => d.index === weekday)?.label ?? "";
  const choices = slots.filter((sl) => kindOf(sl) !== "repeat");

  const addRest = () => {
    const card = addSplitCard({ name: "Rest", kind: "rest" });
    if (card) onPick(card.id);
  };

  const addWorkout = () => {
    const card = addSplitCard({ name: label, kind: "workout" });
    if (card) onPick(card.id);
  };

  if (typeof document === "undefined") return null;

  // Portalled: a route animation leaves a transform on <main>, and a fixed
  // overlay inside a transformed ancestor is positioned against that ancestor
  // rather than against the screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/25 anim-backdrop" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full overflow-y-auto bg-paper px-4 pb-8 pt-4 anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 32px)" }}
      >
        <h2 className="pb-2 t-caption">{label}</h2>
        <div className="group-list">
          {choices.map((slot, i) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => onPick(slot.id)}
              className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
            >
              <span className="min-w-0 truncate t-body text-ink">
                {kindOf(slot) === "rest" ? "Rest" : slot.name}
              </span>
              {slot.weekday !== undefined && (
                <span className="shrink-0 t-label text-ink-2">
                  {DAYS.find((d) => d.index === slot.weekday)?.label}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-3">
          <button
            type="button"
            onClick={addWorkout}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1 bg-ink t-body font-medium text-paper rounded-md"
          >
            <Plus size={16} /> New card
          </button>
          <button
            type="button"
            onClick={addRest}
            className="min-h-[44px] flex-1 bg-wash t-body font-medium text-ink rounded-md"
          >
            Rest day
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
