import { createFileRoute } from "@tanstack/react-router";
import { addDays, format } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { PhaseEditorSheet } from "../components/PhaseEditorSheet";
import { SlotPlanSheet } from "../components/SlotPlanSheet";
import { SplitCardList } from "../components/SplitCardList";
import { Plus } from "../components/icons";
import { Chevron } from "../components/icons";
import { dayKey, parseDayKey } from "../lib/daily-log";
import { phaseForDate, sortPhases, type NutritionPhase } from "../lib/planning";
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

/** How far the preview strip looks ahead. A week is enough to see the next
 *  change-point land without turning this into a second calendar. */
const PREVIEW_DAYS = 7;

/**
 * Two models, shown as what they are.
 *
 * NUTRITION IS A CALENDAR. A timeline of change-points with no end dates, so
 * "cutting from Sunday onward" is one row that covers every day after it.
 *
 * TRAINING IS A ROTATION. It advances when you train rather than when the date
 * changes, so it has no dates and is shown in cycle order. It is deliberately
 * NOT projected onto future days: after a rest day the next slot is a free
 * choice, which makes the future genuinely unknowable, and a plan that is
 * confidently wrong is worse than none. Pin a day when you actually do know.
 */
function PlanPage() {
  const phases = useStore((s) => s.nutritionPhases);
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const plannedDays = useStore((s) => s.plannedDays);
  const unpinDay = useStore((s) => s.unpinDay);
  const takeRestDay = useStore((s) => s.takeRestDay);
  const next = useStore((s) => s.nextCard());
  const hydrated = useStore((s) => s.hydrated);

  const [editingPhase, setEditingPhase] = useState<NutritionPhase | undefined>();
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SplitSlot | undefined>();
  const [cardOpen, setCardOpen] = useState(false);

  const ordered = useMemo(() => sortPhases(phases).reverse(), [phases]);
  const rotation = useMemo(
    () => [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder),
    [slots],
  );
  const restCard = useMemo(() => rotation.find((s) => s.kind === "rest"), [rotation]);

  const today = hydrated ? dayKey(new Date()) : "";

  /** The next week, each day resolved against the timeline. This is where
   *  "individual days" is actually visible, without pretending every day is an
   *  entry somebody has to maintain. */
  const preview = useMemo(() => {
    if (!hydrated) return [];
    const start = parseDayKey(today);
    return Array.from({ length: PREVIEW_DAYS }, (_, i) => {
      const d = addDays(start, i);
      const key = dayKey(d);
      const phase = phaseForDate(phases, key);
      const pin = plannedDays.find((p) => p.date === key);
      return {
        key,
        label: i === 0 ? "Today" : format(d, "EEE d"),
        phase,
        pinned: pin ? slots.find((s) => s.id === pin.splitSlotId) : undefined,
      };
    });
  }, [hydrated, today, phases, plannedDays, slots]);

  const futurePins = useMemo(
    () =>
      [...plannedDays].filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    [plannedDays, today],
  );

  const openPhase = (p?: NutritionPhase) => {
    setEditingPhase(p);
    setPhaseOpen(true);
  };

  return (
    <AppShell>
      <header className="pl-4 pr-12 pb-4 pt-14">
        <h1 className="t-title text-ink">Plan</h1>
      </header>

      {/* ---- Nutrition ------------------------------------------------- */}
      <section className="px-4 anim-fade-up">
        <div className="group-header">
          <h2 className="t-caption">Nutrition</h2>
          <button type="button" onClick={() => openPhase(undefined)} className="t-action t-label">
            Add
          </button>
        </div>

        {ordered.length === 0 ? (
          <div className="group-list px-4 py-5">
            <p className="t-body text-ink-2">Nothing planned yet</p>
          </div>
        ) : (
          <div className="group-list">
            {ordered.map((p, i) => {
              const current = hydrated && phaseForDate(phases, today)?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openPhase(p)}
                  className={`group-row w-full text-left ${i === 0 ? "" : "group-row-sep"}`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate t-body font-medium text-ink">{p.name}</span>
                      {current && <span className="shrink-0 t-label text-ink-3">now</span>}
                    </span>
                    <span className="block t-label text-ink-2">
                      {format(parseDayKey(p.startsOn), "d MMM yyyy")}
                      {p.kind === "targets" && summarise(p) ? ` · ${summarise(p)}` : ""}
                    </span>
                  </span>
                  <Chevron className="shrink-0 text-ink-3" size={16} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- The next week, resolved ----------------------------------- */}
      {hydrated && ordered.length > 0 && (
        <section className="px-4 section-gap anim-fade-up">
          <div className="group-header">
            <h2 className="t-caption">Next 7 days</h2>
          </div>
          <div className="group-list">
            {preview.map((d, i) => (
              <div key={d.key} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
                <span className="t-body text-ink">{d.label}</span>
                <span className="flex min-w-0 items-baseline gap-2 text-right">
                  {d.pinned && <span className="shrink-0 t-label text-ink">{d.pinned.name}</span>}
                  <span className="truncate t-label text-ink-2">
                    {d.phase
                      ? d.phase.kind === "untracked"
                        ? "Untracked"
                        : (summarise(d.phase) ?? d.phase.name)
                      : "No targets"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

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

        {restCard && next?.id === restCard.id && (
          // Only offered when a rest is actually what is next, because taking
          // one out of turn would silently jump the split forward.
          <button
            type="button"
            onClick={() => takeRestDay(restCard.id)}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-surface t-body font-medium text-ink"
          >
            Take today off
          </button>
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

      <PhaseEditorSheet phase={editingPhase} open={phaseOpen} onClose={() => setPhaseOpen(false)} />
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

/** "3,000 cal · 24,000 steps", or undefined when a phase carries no numbers. */
function summarise(p: NutritionPhase): string | undefined {
  const parts: string[] = [];
  if (p.calories !== undefined) parts.push(`${p.calories.toLocaleString()} cal`);
  if (p.protein !== undefined) parts.push(`${p.protein}p`);
  if (p.steps !== undefined) parts.push(`${p.steps.toLocaleString()} steps`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
