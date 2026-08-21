import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { HabitEditorSheet } from "./HabitEditorSheet";

function CheckIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
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
              className="group-row w-full t-body font-medium text-accent"
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
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                      isDone ? "bg-accent text-accent-foreground" : "border border-border bg-muted"
                    }`}
                  >
                    {isDone && <CheckIcon />}
                  </span>
                  <span
                    className={`flex-1 truncate t-body transition-colors ${
                      isDone ? "text-muted-foreground font-normal" : "text-foreground font-medium"
                    }`}
                  >
                    {habit.name}
                  </span>
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
              <span className="tnum t-label text-muted-foreground">
                {doneCount} of {totalCount} done
              </span>
              <span className="t-body font-medium text-accent">Edit habits</span>
            </button>
          </li>
        </ul>
      )}

      <HabitEditorSheet open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
