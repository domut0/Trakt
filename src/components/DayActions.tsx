import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Plus } from "./icons";
import { useStore } from "../lib/store";
import { useCoachStore } from "../lib/coach-store";
import { dayKey } from "../lib/daily-log";
import { isCardioSession } from "../lib/store";
import { kindOf } from "../lib/planning";
import { StartWorkoutSheet } from "./StartWorkoutSheet";
import { WorkoutChooserSheet } from "./WorkoutChooserSheet";

/**
 * What you can do to a day, under the numbers you logged for it.
 *
 * This is the thing Today and History now share. They used to diverge: Today
 * had a flame button in the nav bar that always meant "now", and History had
 * its own "Add a workout" that meant "this day". Two controls, two labels, two
 * behaviours, for one action - and the nav-bar one could not be given a date at
 * all, because a tab bar is not on a day.
 *
 * So the action moved out of the bar and onto the day, which is the thing it
 * was always about. Today and History are now the same screen with a different
 * date picker above them: a week strip on one, a month grid on the other.
 *
 * "Add activity" rather than "Start workout": cardio is logged through the same
 * sheet and is not a workout you start, and on a past day nothing is being
 * started at all.
 */
export function DayActions({ date }: { date: string }) {
  const router = useRouter();
  const sessions = useStore((s) => s.sessions);
  const plannedCardFor = useStore((s) => s.plannedCardFor);
  const slots = useStore((s) => s.slots);
  const plannedDays = useStore((s) => s.plannedDays);
  const planningMode = useStore((s) => s.planningMode);
  // Logging is the one thing coach mode cannot offer: the data on screen is a
  // client's, and the read-only latch would refuse the write anyway. Better to
  // say so than to open a sheet that silently does nothing.
  const viewingClient = useCoachStore((s) => s.viewing !== undefined);

  const [chooserOpen, setChooserOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  /** The chooser, opened straight onto cardio for a planned cardio day. */
  const [cardioOpen, setCardioOpen] = useState(false);

  const todayKey = dayKey(new Date());

  /**
   * Whether this day already holds a strength workout.
   *
   * Cardio deliberately does not count. A bike ride is not the planned Upper
   * day, and having logged one is no reason to stop offering to start the other.
   */
  const sessionsThisDay = useMemo(
    () => sessions.filter((s) => dayKey(new Date(s.startedAt)) === date),
    [sessions, date],
  );

  // Recomputed when the plan changes, not only when the date does: editing the
  // split has to move every day it governs, and the resolver is a store getter
  // React cannot see through on its own.
  const planned = useMemo(
    () => plannedCardFor(date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, slots, plannedDays, planningMode, plannedCardFor],
  );

  const plannedIsCardio = planned !== undefined && kindOf(planned) === "cardio";

  /**
   * Whether the day's planned session has already been done.
   *
   * Matched by KIND, not merely by "something was logged". A bike ride is not
   * the planned Upper day, and logging one is no reason to stop offering to
   * start the other - nor is a squat session a reason to stop offering the
   * conditioning the plan asked for.
   */
  const alreadyDone = plannedIsCardio
    ? sessionsThisDay.some((s) => isCardioSession(s))
    : sessionsThisDay.some((s) => !isCardioSession(s));

  // Offered while the day still has its planned session ahead of it. Once it is
  // done, the plan for that day is spent and the button would be offering to do
  // it twice.
  const showStart = planned !== undefined && !alreadyDone && !viewingClient;

  return (
    <>
      <button
        type="button"
        onClick={() => setChooserOpen(true)}
        disabled={viewingClient}
        aria-label={
          viewingClient ? "Logging is unavailable while viewing a client" : "Add activity"
        }
        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-surface t-body font-medium text-ink disabled:opacity-40"
      >
        <Plus size={18} />
        Add activity
      </button>

      {showStart && (
        // Names the card, because "Start workout" on a day the plan already has
        // an answer for is asking a question it knows the answer to.
        <button
          type="button"
          onClick={() => (plannedIsCardio ? setCardioOpen(true) : setStartOpen(true))}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-md bg-ink t-body font-semibold text-paper"
        >
          Start {planned.name} day
        </button>
      )}

      <WorkoutChooserSheet
        open={chooserOpen || cardioOpen}
        startOn={cardioOpen ? "cardio" : "choose"}
        onClose={() => {
          setChooserOpen(false);
          setCardioOpen(false);
        }}
        onChooseStrength={() => {
          setChooserOpen(false);
          setCardioOpen(false);
          setStartOpen(true);
        }}
      />

      <StartWorkoutSheet
        open={startOpen}
        // The day you are looking at, never "now". Opening this from a past day
        // in History and having it log today is the bug this whole component
        // exists to make impossible.
        on={date === todayKey ? undefined : date}
        onClose={() => setStartOpen(false)}
        onStart={() => {
          setStartOpen(false);
          void router.navigate({ to: "/workout" });
        }}
      />
    </>
  );
}
