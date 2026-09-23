import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { kindOf } from "../lib/planning";
import { useStore, type SplitSlot } from "../lib/store";
import { Close } from "./icons";

/**
 * A card in the split, to be read rather than edited.
 *
 * ## Why this exists
 *
 * A client whose plan comes from their coach cannot edit it, and the Plan tab
 * said so by making the whole section `inert`. That is the right answer to
 * "can I change this" and the wrong answer to "what is it": the one person the
 * programme was written for could see that Wednesday says "Upper" and could
 * not find out that Upper is five lifts, or what load was prescribed for any
 * of them, without starting the workout to look.
 *
 * Reading is not a write. So a locked card is tappable again, and this is what
 * it opens.
 *
 * ## No actions at all
 *
 * Not the editor with its controls disabled. A sheet full of greyed-out fields
 * is an argument about permissions; this is a page from a programme. The only
 * control on it is the way out.
 */
export function PlannedCardSheet({
  slot,
  open,
  onClose,
}: {
  slot: SplitSlot | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const exercises = useStore((s) => s.exercises);

  useSheetDismiss(open, onClose);

  if (!open || !slot || typeof document === "undefined") return null;

  const kind = kindOf(slot);
  const lifts = slot.plannedLifts ?? [];
  const cardio = slot.plannedCardio;
  const cardioName = cardio
    ? (exercises.find((e) => e.id === cardio.exerciseId)?.name ?? "Cardio")
    : undefined;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/25 anim-backdrop" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto bg-paper px-4 pt-4 anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 32px)" }}
        role="dialog"
        aria-label={slot.name}
      >
        <div className="flex items-start justify-between gap-3 pb-3">
          <h2 className="min-w-0 text-balance break-words t-heading text-ink">
            {kind === "repeat" ? "Back to the top" : slot.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-ink-2"
          >
            <Close size={18} />
          </button>
        </div>

        {kind === "rest" && <p className="pb-2 t-body text-ink-2">A rest day. Nothing planned.</p>}

        {kind === "repeat" && (
          <p className="pb-2 t-body text-ink-2">
            Not a day. Reaching this sends the split back to its first card.
          </p>
        )}

        {kind === "workout" &&
          (lifts.length > 0 ? (
            <div className="group-list">
              {lifts.map((lift, i) => {
                const name = exercises.find((e) => e.id === lift.exerciseId)?.name;
                return (
                  <div
                    key={`${lift.exerciseId}-${i}`}
                    className={`group-row ${i === 0 ? "" : "group-row-sep"}`}
                  >
                    <span className="min-w-0 truncate t-body text-ink">{name ?? "Unknown"}</span>
                    {/* Whatever the plan actually says, and nothing where it
                        says nothing: a lift prescribed as a name in an order
                        is a legal prescription, and inventing "3 × 8" for it
                        would be the app writing the programme. */}
                    <span className="shrink-0 tnum t-body text-ink-2">{prescription(lift)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="pb-2 t-body text-ink-2">No lifts chosen.</p>
          ))}

        {cardioName && (
          <>
            <div className="group-header pt-4">
              <h3 className="t-caption">{kind === "cardio" ? "Cardio" : "Finisher"}</h3>
            </div>
            <div className="group-list">
              <div className="group-row">
                <span className="min-w-0 truncate t-body text-ink">{cardioName}</span>
                <span className="shrink-0 tnum t-body text-ink-2">{cardioAmount(cardio)}</span>
              </div>
            </div>
          </>
        )}

        {kind === "cardio" && !cardioName && (
          <p className="pb-2 t-body text-ink-2">Cardio, with the activity left to you.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** "3 × 8 @ 135 lbs", with every part the plan left out left out. */
function prescription(lift: { sets?: number; reps?: string; load?: string }): string {
  const volume = [lift.sets, lift.reps].every((v) => v === undefined)
    ? undefined
    : [lift.sets, lift.reps].filter((v) => v !== undefined).join(" × ");
  return [volume, lift.load].filter(Boolean).join(" @ ");
}

function cardioAmount(cardio: { durationMinutes?: number; distance?: number } | undefined): string {
  if (!cardio) return "";
  return [
    cardio.durationMinutes === undefined ? undefined : `${cardio.durationMinutes} min`,
    cardio.distance === undefined ? undefined : `${cardio.distance}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
