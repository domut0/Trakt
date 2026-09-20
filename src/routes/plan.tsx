import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { NutritionRibbon } from "../components/NutritionRibbon";
import { TargetStrip } from "../components/TargetStrip";
import { SlotPlanSheet } from "../components/SlotPlanSheet";
import { SplitCardList } from "../components/SplitCardList";
import { WeekPlanner } from "../components/WeekPlanner";
import { SaveChangesBar } from "../components/SaveChangesBar";
import { CoachPlanCard } from "../components/CoachPlanPrompt";
import { CoachManagedBanner } from "../components/CoachManagedBanner";
import { usePlanLocked } from "../lib/plan-lock";
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
 * TRAINING IS ONE OF TWO THINGS, and which one is part of the plan.
 *
 * A WEEK is seven days, each holding a card, repeating. It is the default and
 * what most people mean by a programme. A missed day is a missed day: nothing
 * rolls forward, or by Friday the app would be showing Tuesday's workout.
 *
 * A ROTATION advances when you train rather than when the date changes, so it
 * has no dates and is shown in cycle order. It is what Upper/Lower x infinity
 * needs, and it is deliberately NOT projected onto future days: after a rest
 * day the next card is a free choice, which makes the future genuinely
 * unknowable. Pin a day when you actually do know.
 */
function PlanPage() {
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const plannedDays = useStore((s) => s.plannedDays);
  const unpinDay = useStore((s) => s.unpinDay);
  const next = useStore((s) => s.nextCard());
  const hydrated = useStore((s) => s.hydrated);
  const locked = usePlanLocked();
  const planningMode = useStore((s) => s.planningMode);
  const setPlanningMode = useStore((s) => s.setPlanningMode);

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
          coach-issued plan they have not absorbed. The review screen itself is
          mounted by the shell, so it can open over any tab. */}
      <CoachPlanCard />
      <CoachManagedBanner />

      {/* Inert while a coach manages the plan: readable, not editable. The
          store refuses these edits anyway; this is so nothing looks tappable. */}
      <div inert={locked}>
        <NutritionRibbon />
        <TargetStrip />

        {/* ---- The workout split ----------------------------------------- */}
        {planningMode === "week" ? (
          <WeekPlanner
            onEdit={(slot) => {
              setEditingSlot(slot);
              setCardOpen(true);
            }}
          />
        ) : (
          <section className="px-4 section-gap anim-fade-up">
            <div className="group-header">
              <h2 className="t-caption">Workout split</h2>
              {!locked && (
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
              )}
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
        )}

        {/* The two ways to arrange a split, as one setting that decides which
            screen this is. A rotation advances when you train; a week repeats.
            Switching rearranges the cards and creates or deletes nothing, so
            every session logged against a card stays attached to it. */}
        <div className="px-4 pt-2">
          <div className="flex gap-1 rounded-md bg-wash p-1">
            {(["week", "rotation"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPlanningMode(mode)}
                aria-pressed={planningMode === mode}
                className={`min-h-[44px] flex-1 rounded-md t-label font-medium ${
                  planningMode === mode ? "bg-ink text-paper" : "text-ink-2"
                }`}
              >
                {mode === "week" ? "Week" : "Rotation"}
              </button>
            ))}
          </div>
        </div>

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
      </div>

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
