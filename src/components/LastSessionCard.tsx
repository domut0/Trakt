import { format, isToday, isYesterday } from "date-fns";
import { useMemo } from "react";
import { lastSessionFor } from "../lib/exercise-history";
import { useStore } from "../lib/store";

/**
 * How many sets are listed before the card stops growing. Past this it is
 * competing for height with the plan list and the log button, and the sets you
 * are actually pacing against are the early ones.
 */
const MAX_ROWS = 6;

/**
 * What you did last time you trained this lift, on the screen where you need it.
 *
 * The only way to see this used to be History - which means leaving the workout,
 * finding the session, finding the lift, and coming back, mid-set, with the
 * numbers held in your head. The set logger already prefills the last set's
 * weight and reps, but one set is not the information: whether last week's
 * 45x6, 45x5, 40x6 should become 47.5 today is a question about the SHAPE of
 * the session, and a prefill cannot show a shape.
 *
 * Renders nothing at all the first time you ever do a lift, rather than a card
 * saying there is nothing - an empty state here would occupy the same space as
 * the thing it is apologising for.
 */
export function LastSessionCard({
  exerciseId,
  excludeSessionId,
}: {
  exerciseId: string | undefined;
  /** The workout in progress, so it is kept out of its own answer. */
  excludeSessionId: string | undefined;
}) {
  const sets = useStore((s) => s.sets);
  const sessions = useStore((s) => s.sessions);
  const unit = useStore((s) => s.unit);

  const last = useMemo(
    () => (exerciseId ? lastSessionFor(sets, sessions, exerciseId, excludeSessionId) : undefined),
    [sets, sessions, exerciseId, excludeSessionId],
  );

  if (!last) return null;

  const shown = last.sets.slice(0, MAX_ROWS);
  const hidden = last.sets.length - shown.length;

  return (
    <section className="mx-4 mt-2 rounded-lg bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-caption text-ink-2">Last session</h2>
        <span className="shrink-0 t-label text-ink-3">{whenLabel(last.date)}</span>
      </div>

      <ol className="mt-2">
        {shown.map((set, i) => (
          <li key={set.id} className="flex items-baseline gap-3 py-0.5">
            {/* The set number is a position, not a quantity, so it is set in the
                quietest ink and given a fixed column - the weights beside it
                have to line up, and a two-digit set would otherwise shift
                every row under it. */}
            <span className="w-4 shrink-0 tnum t-label text-ink-3">{i + 1}</span>
            <span className="tnum t-body text-ink">
              {set.weight} {unit} × {set.reps}
            </span>
            {set.rpe != null && <span className="tnum t-label text-ink-3">@ {set.rpe}</span>}
          </li>
        ))}
      </ol>

      {hidden > 0 && (
        <p className="mt-1 t-label text-ink-3">
          +{hidden} more {hidden === 1 ? "set" : "sets"}
        </p>
      )}
    </section>
  );
}

/** "Today" and "Yesterday" are what a person says; anything older is a date. */
function whenLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE d MMM");
}
