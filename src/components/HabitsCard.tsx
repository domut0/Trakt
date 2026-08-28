import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { HabitEditorSheet } from "./HabitEditorSheet";

/**
 * The completion mark.
 *
 * A filled square against an open one, at the same footprint so a list does not
 * reflow as items are ticked. This replaces a blue filled circle with a white
 * tick inside it, which was carrying the state in hue and shape at once and
 * therefore twice over in the one channel that fails first.
 *
 * The name beside it keeps full ink either way. The old card faded a completed
 * habit to muted grey, which on a paper ground reads as disabled rather than as
 * done, and it meant the four things he actually finished were the four hardest
 * to see. The square is the whole signal; the row is just a row.
 */
function HabitMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-[14px] w-[14px] shrink-0 rounded-sm ${done ? "bg-ink" : "mark-open"}`}
    />
  );
}

/**
 * Daily habit checklist card for the Today screen.
 *
 * `date` is passed directly as a local "yyyy-MM-dd" key. Toggling completion is
 * a synchronous store mutation for instant tactile feedback.
 */
export function HabitsCard({ date }: { date: string }) {
  const habits = useStore((s) => s.habits);
  const habitEntries = useStore((s) => s.habitEntries);
  const toggleHabit = useStore((s) => s.toggleHabit);

  const [editorOpen, setEditorOpen] = useState(false);

  const activeHabits = useMemo(
    () => habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order),
    [habits],
  );

  const completedIds = useMemo(
    () => new Set(habitEntries.filter((e) => e.date === date).map((e) => e.habitId)),
    [habitEntries, date],
  );

  const doneCount = activeHabits.filter((h) => completedIds.has(h.id)).length;
  const totalCount = activeHabits.length;

  // One container, not two. The habits are a plain `group-list`: the outer
  // `rounded-2xl bg-surface` card this used to sit in was a second container
  // of the same fill around the same rows, so it was invisible and cost a
  // wrapper plus 16px of padding for nothing. No card title either: the only
  // caller (Today) already renders a "Habits" group header directly above.
  //
  // The count and the editor share the group's last row instead of a header
  // band above a separator. A count is not a control, so it no longer wears a
  // pill; the row that carries it IS a control, is 44px tall by construction,
  // and says so in accent.
  return (
    <div>
      {totalCount === 0 ? (
        <ul className="group-list">
          <li>
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="group-row w-full t-action t-body"
            >
              Add your first habit
            </button>
          </li>
        </ul>
      ) : (
        <ul className="group-list">
          {activeHabits.map((habit, idx) => {
            const isDone = completedIds.has(habit.id);
            return (
              <li key={habit.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  onClick={() => toggleHabit(date, habit.id)}
                  className={`group-row w-full text-left transition-colors ${
                    idx > 0 ? "group-row-sep" : ""
                  }`}
                >
                  <HabitMark done={isDone} />
                  <span className="flex-1 truncate t-body text-ink">{habit.name}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              aria-label="Edit habits"
              className="group-row group-row-sep w-full text-left"
            >
              <span className="tnum t-label text-ink-2">
                {doneCount} of {totalCount} done
              </span>
              <span className="t-action t-body">Edit habits</span>
            </button>
          </li>
        </ul>
      )}

      <HabitEditorSheet open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
