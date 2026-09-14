import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { NutritionRibbon } from "../components/NutritionRibbon";
import { TargetStrip } from "../components/TargetStrip";
import { SlotPlanSheet } from "../components/SlotPlanSheet";
import { SplitCardList } from "../components/SplitCardList";
import { SaveChangesBar } from "../components/SaveChangesBar";
import { CoachPlanPrompt } from "../components/CoachPlanPrompt";
import { Plus } from "../components/icons";
import { Chevron } from "../components/icons";
import { dayKey, parseDayKey } from "../lib/daily-log";
import { useStore, type SplitSlot } from "../lib/store";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Plan" },
      { name: "description", content: "What you intend to eat and train." },
      { property: "og:title", content: "Plan" },
      { property: "og:description", content: "What you intend to eat and train." },
    ],
  }),
  component: PlanPage,
});

/**
 * Two models, shown as what they are.
 *
 * NUTRITION IS A CALENDAR. A timeline of change-points with no end dates, so
 * "cutting from Sunday onward" is one change-point that covers every day after
 * it. The ribbon draws that timeline and is also how it is edited.
 *
 * TRAINING IS A ROTATION. It advances when you train rather than when the date
 * changes, so it has no dates and is shown in cycle order. It is deliberately
 * NOT projected onto future days: after a rest day the next slot is a free
 * choice, which makes the future genuinely unknowable, and a plan that is
 * confidently wrong is worse than none. Pin a day when you actually do know.
 */
function PlanPage() {
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const plannedDays = useStore((s) => s.plannedDays);
  const unpinDay = useStore((s) => s.unpinDay);
  const next = useStore((s) => s.nextCard());
  const hydrated = useStore((s) => s.hydrated);

  const [editingSlot, setEditingSlot] = useState<SplitSlot | undefined>();
  const [cardOpen, setCardOpen] = useState(false);

  const rotation = useMemo(
    () => [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder),
    [slots],
  );

  const today = hydrated ? dayKey(new Date()) : "";

  const futurePins = useMemo(
    () =>
      [...plannedDays].filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    [plannedDays, today],
  );

  return (
    <AppShell>
      <header className="pl-4 pr-12 pb-4 pt-14">
        <h1 className="t-title text-ink">Plan</h1>
      </header>

      {/* Coach mode only: renders nothing unless a client's plan is on screen
          and it has been edited. The Plan tab itself needs no coach-specific
          branching -- it edits store state, and in coach mode the store holds
          the client's plan. */}
      <SaveChangesBar />

      {/* The client's side: renders nothing unless their sheet holds a
          coach-issued plan they have not absorbed. */}
      <CoachPlanPrompt />

      <NutritionRibbon />
      <TargetStrip />

      {/* ---- The workout split ----------------------------------------- */}
      <section className="px-4 section-gap anim-fade-up">
        <div className="group-header">
          <h2 className="t-caption">Workout split</h2>
          <button
            type="button"
            onClick={() => {
              setEditingSlot(undefined);
              setCardOpen(true);
            }}
            aria-label="Add a card to the split"
            className="flex min-h-[44px] items-center text-ink"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Directly under the heading, where the user asked for it: what you do
            next is the one thing this section is read for. */}
        {next && <p className="px-4 pb-2 t-label text-ink-2">Next: {next.name}</p>}

        {rotation.length === 0 ? (
          <div className="group-list px-4 py-5">
            <p className="t-body text-ink-2">No cards yet</p>
          </div>
        ) : (
          <SplitCardList
            onEdit={(slot) => {
              setEditingSlot(slot);
              setCardOpen(true);
            }}
          />
        )}
      </section>

      {/* ---- Pinned ---- */}
      {futurePins.length > 0 && (
        <section className="px-4 section-gap anim-fade-up">
          <div className="group-header">
            <h2 className="t-caption">Pinned</h2>
          </div>
          <div className="group-list">
            {futurePins.map((p, i) => (
              <div key={p.date} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
                <span className="min-w-0">
                  <span className="block t-body text-ink">
                    {slots.find((s) => s.id === p.splitSlotId)?.name ?? "Unknown"}
                  </span>
                  <span className="block t-label text-ink-2">
                    {format(parseDayKey(p.date), "EEE d MMM")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => unpinDay(p.date)}
                  className="shrink-0 min-h-[44px] px-2 t-action t-label"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="pb-8" />

      <SlotPlanSheet
        slot={editingSlot}
        open={cardOpen}
        onClose={() => {
          setCardOpen(false);
          setEditingSlot(undefined);
        }}
      />
    </AppShell>
  );
}
