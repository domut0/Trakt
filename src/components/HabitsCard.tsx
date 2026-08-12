import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { HabitEditorSheet } from "./HabitEditorSheet";

function SettingsIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

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
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Daily supplement checklist card for the Today screen.
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

  return (
    <div className="rounded-2xl bg-surface px-5 py-4">
      {/* Header with compact progress indicator and editor button */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-tight">Supplements</span>
          {totalCount > 0 && (
            <span className="tnum rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
              {doneCount} of {totalCount}
            </span>
          )}
        </div>
        <button
          onClick={() => setEditorOpen(true)}
          aria-label="Edit supplements"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SettingsIcon />
        </button>
      </div>

      {/* Checklist items or prompt to add the first supplement */}
      {totalCount === 0 ? (
        <button
          onClick={() => setEditorOpen(true)}
          className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-muted/50 px-4 py-3 text-[14px] font-medium text-accent hover:bg-muted"
        >
          + Add your first supplement
        </button>
      ) : (
        <div className="divide-y divide-border/40">
          {activeHabits.map((habit) => {
            const isDone = completedIds.has(habit.id);
            return (
              <button
                key={habit.id}
                type="button"
                role="checkbox"
                aria-checked={isDone}
                onClick={() => toggleHabit(date, habit.id)}
                className="flex min-h-[44px] w-full items-center gap-3 py-3 text-left transition-colors"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isDone
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-muted/30"
                  }`}
                >
                  {isDone && <CheckIcon />}
                </span>
                <span
                  className={`text-[15px] transition-colors ${
                    isDone ? "text-muted-foreground font-normal" : "text-foreground font-medium"
                  }`}
                >
                  {habit.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <HabitEditorSheet open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
