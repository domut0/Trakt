import { useRef } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useDialogFocus } from "../hooks/useDialogFocus";
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
 * One scroll area holds the whole prescription, including its finisher. The
 * header stays reachable. An optional Edit action is supplied by the caller
 * only when the current plan may be changed.
 */
export function PlannedCardSheet({
  slot,
  open,
  onClose,
  onEdit,
}: {
  slot: SplitSlot | undefined;
  open: boolean;
  onClose: () => void;
  onEdit?: (slot: SplitSlot) => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useSheetDismiss(open, onClose);

  useDialogFocus(open, containerRef);

  if (!open || !slot || typeof document === "undefined") return null;

  const kind = kindOf(slot);
  const lifts = slot.plannedLifts ?? [];
  const cardio = slot.plannedCardio;
  const cardioName = cardio
    ? (exercises.find((e) => e.id === cardio.exerciseId)?.name ?? "Cardio")
    : undefined;

  const handleEdit = () => {
    onClose();
    if (onEdit && slot) {
      onEdit(slot);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-paper anim-backdrop"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={kind === "repeat" ? "Back to the top" : slot.name}
        className="flex h-full w-full flex-col bg-paper outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="shrink-0 flex items-center justify-between gap-3 border-b border-wash px-4 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
        >
          <h2 className="min-w-0 text-balance break-words t-heading text-ink">
            {kind === "repeat" ? "Back to the top" : slot.name}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <button
                type="button"
                onClick={handleEdit}
                aria-label={`Edit ${slot.name}`}
                className="flex min-h-[44px] items-center justify-center px-3 t-body font-medium text-ink"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2"
            >
              <Close size={18} />
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 32px)" }}
        >
          {kind === "rest" && (
            <p className="pb-2 t-body text-ink-2">A rest day. Nothing planned.</p>
          )}

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
                  const pres = prescription(lift);
                  return (
                    <div
                      key={`${lift.exerciseId}-${i}`}
                      className={`min-h-[48px] px-4 py-3 ${i === 0 ? "" : "group-row-sep"}`}
                    >
                      <span className="block break-words t-body font-medium text-ink">
                        {name ?? "Unknown"}
                      </span>
                      {pres && (
                        <span className="mt-1 block break-words tnum t-label text-ink-2">
                          {pres}
                        </span>
                      )}
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
                <div className="min-h-[48px] px-4 py-3">
                  <span className="block break-words t-body font-medium text-ink">
                    {cardioName}
                  </span>
                  <span className="mt-1 block break-words tnum t-label text-ink-2">
                    {cardioAmount(cardio)}
                  </span>
                </div>
              </div>
            </>
          )}

          {kind === "cardio" && !cardioName && (
            <p className="pb-2 t-body text-ink-2">Cardio, with the activity left to you.</p>
          )}
        </div>
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
