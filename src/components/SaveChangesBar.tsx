import { useState } from "react";
import { useCoachStore } from "../lib/coach-store";
import { useStore } from "../lib/store";
import { useToast } from "./Toast";

/**
 * "Save changes", floating over the Plan tab in coach mode.
 *
 * Shown only when the plan on screen differs from the one that was in the
 * client's sheet when this view opened, so it is never lit for work already
 * sent. It sits at z-40 over BottomNav (z-30) rather than inside it, because
 * the nav's geometry is five equal columns and a sixth thing in the bar would
 * break the axis the action button sits on.
 */
export function SaveChangesBar() {
  const viewing = useCoachStore((s) => s.viewing);
  const saving = useCoachStore((s) => s.saving);
  const save = useCoachStore((s) => s.saveClientPlan);
  const pendingChanges = useCoachStore((s) => s.pendingChanges);
  const showToast = useToast();
  const [open, setOpen] = useState(false);

  // Subscribing to the plan slices is what makes this recompute as the coach
  // edits: `pendingChanges` reads the store imperatively, so without these the
  // bar would only re-render when coach state happened to change.
  useStore((s) => s.nutritionPhases);
  useStore((s) => s.slots);
  useStore((s) => s.plannedDays);

  if (!viewing) return null;
  const changes = pendingChanges();
  if (changes.length === 0) return null;

  const label = changes.length === 1 ? "1 change" : `${changes.length} changes`;

  return (
    <>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-y-auto bg-paper px-4 pb-28 pt-4">
          <h2 className="pb-2 t-caption">
            {label} for {viewing.client.name}
          </h2>
          <ul className="space-y-2">
            {changes.map((c, i) => (
              <li key={i} className="border-b border-rule pb-2">
                <span className="block t-label text-ink-2">{c.area}</span>
                <span className="block t-body text-ink">
                  {c.kind === "removed" ? "Remove " : c.kind === "added" ? "Add " : ""}
                  {c.subject}
                </span>
                {c.detail && <span className="block t-label text-ink-2">{c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
        // Clears BottomNav, which carries its own safe-area padding below it.
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)" }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Hide the change list" : `Review ${label}`}
            className="min-h-[44px] bg-paper px-3 t-label font-medium text-ink ring-1 ring-rule rounded-md"
          >
            {open ? "Hide" : label}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void save().then((ok) => {
                setOpen(false);
                showToast({
                  message: ok
                    ? `Plan sent to ${viewing.client.name}.`
                    : "Couldn't reach that client's sheet.",
                  durationMs: 4000,
                });
              });
            }}
            className="min-h-[44px] bg-ink px-5 t-body font-semibold text-paper rounded-md"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}
