import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore } from "../lib/store";

function ArrowUpIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function UnarchiveIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <polyline points="10 12 12 10 14 12" />
      <line x1="12" y1="10" x2="12" y2="16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Habit list manager. Portaled into document.body following WorkoutChooserSheet's
 * structural pattern.
 *
 * Designed for low-friction batch data entry: submitting an item clears the field
 * while retaining input focus so multiple habits can be added sequentially.
 */
export function HabitEditorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const habits = useStore((s) => s.habits);
  const addHabit = useStore((s) => s.addHabit);
  const renameHabit = useStore((s) => s.renameHabit);
  const deleteHabit = useStore((s) => s.deleteHabit);
  const setHabitArchived = useStore((s) => s.setHabitArchived);
  const reorderHabits = useStore((s) => s.reorderHabits);

  const [newHabitName, setNewHabitName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setNewHabitName("");
    setEditingId(null);
    setConfirmDeleteId(null);
    // Deferred a tick because the portal content is only in the document after
    // this commit. Cleared on unmount so closing the sheet mid-delay cannot
    // leave a pending focus call behind.
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [open]);

  const activeHabits = useMemo(
    () => habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order),
    [habits],
  );

  const archivedHabits = useMemo(
    () => habits.filter((h) => h.archived).sort((a, b) => a.order - b.order),
    [habits],
  );

  // Above the guard below, deliberately: hooks cannot live after a return.
  //
  // This is the one sheet where Escape already meant something before it meant
  // "close": the rename field binds it to cancel the rename. That field now
  // calls preventDefault, which useSheetDismiss treats as "already handled", so
  // one press cancels the rename and a second closes the sheet. Without it a
  // single press would do both, losing the sheet as collateral damage from
  // backing out of a typo.
  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const handleAdd = () => {
    const trimmed = newHabitName.trim();
    if (!trimmed) return;
    addHabit(trimmed);
    setNewHabitName("");
    inputRef.current?.focus();
  };

  const commitRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      renameHabit(id, trimmed);
    }
    setEditingId(null);
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const current = activeHabits[index];
    const prev = activeHabits[index - 1];
    reorderHabits(current.id, prev.id);
  };

  const moveDown = (index: number) => {
    if (index >= activeHabits.length - 1) return;
    const current = activeHabits[index];
    const next = activeHabits[index + 1];
    reorderHabits(current.id, next.id);
  };

  // `data-swipe-ignore`: this sheet is owned by HabitsCard, which renders
  // inside AppShell's <main>. React portals bubble along the React tree rather
  // than the DOM tree, so touches in here still reach <main>'s
  // swipe-between-tabs handler, and a drag with any horizontal component would
  // navigate off Today mid-edit. AppShell's shouldIgnoreSwipe resolves this
  // attribute with a DOM `closest`, which works from the portal's real position
  // under document.body. WorkoutChooserSheet and StartWorkoutSheet need no such
  // attribute: AppShell mounts them as siblings of <main>, not inside it.
  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col bg-paper rule-heavy-t p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <h2 className="t-heading font-semibold tracking-tight">Manage habits</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label text-ink-2 hover:text-ink"
          >
            Done
          </button>
        </div>

        {/* Add new habit input */}
        <div className="shrink-0 pb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              aria-label="Habit name"
              value={newHabitName}
              onChange={(e) => setNewHabitName(e.target.value)}
              placeholder="Add habit (e.g. Creatine)"
              className="min-h-[44px] flex-1 bg-wash px-3.5 t-body outline-none placeholder:text-ink-2 focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={!newHabitName.trim()}
              className="min-h-[44px] bg-ink px-4 t-body font-semibold text-paper disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </div>

        {/* Scrollable list of active items & archived section */}
        <div className="flex-1 overflow-y-auto pr-0.5 space-y-3">
          {activeHabits.length === 0 ? (
            <p className="py-4 text-center t-label text-ink-2">
              No active habits. Add one above to start tracking.
            </p>
          ) : (
            <div className="group-list bg-wash">
              {activeHabits.map((habit, idx) => (
                <div
                  key={habit.id}
                  className={`group-row flex-col justify-center p-2.5 ${
                    idx > 0 ? "group-row-sep" : ""
                  }`}
                >
                  {confirmDeleteId === habit.id ? (
                    <div className="flex w-full flex-col gap-2 p-1">
                      <p className="t-label font-medium text-signal">
                        Delete habit and all its history?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            deleteHabit(habit.id);
                            setConfirmDeleteId(null);
                          }}
                          className="min-h-[44px] flex-1 bg-signal px-3 t-label font-semibold text-white"
                        >
                          Delete history
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[44px] flex-1 bg-wash px-3 t-label font-medium text-ink-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {editingId === habit.id ? (
                          <input
                            autoFocus
                            type="text"
                            aria-label="Edit habit name"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => commitRename(habit.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(habit.id);
                              if (e.key === "Escape") {
                                // Claims the press so useSheetDismiss leaves it
                                // alone: backing out of a rename must not also
                                // close the sheet.
                                e.preventDefault();
                                setEditingId(null);
                              }
                            }}
                            className="w-full px-2 py-1 t-body font-medium text-ink outline-none ring-1 ring-accent"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(habit.id);
                              setEditingName(habit.name);
                            }}
                            aria-label={`Rename ${habit.name}`}
                            className="flex min-h-[44px] w-full items-center text-left t-body t-action text-ink"
                            title="Tap to rename"
                          >
                            <span className="truncate">{habit.name}</span>
                          </button>
                        )}
                      </div>

                      {/* gap-0.5, not gap-1: four 44px controls plus the name have
                          to fit a 375px viewport without the name collapsing. */}
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          aria-label={`Move ${habit.name} up`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-30"
                        >
                          <ArrowUpIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDown(idx)}
                          disabled={idx === activeHabits.length - 1}
                          aria-label={`Move ${habit.name} down`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-30"
                        >
                          <ArrowDownIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => setHabitArchived(habit.id, true)}
                          aria-label={`Archive ${habit.name}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-ink"
                          title="Archive (keeps history)"
                        >
                          <ArchiveIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(habit.id)}
                          aria-label={`Delete ${habit.name}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-signal"
                          title="Delete"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {archivedHabits.length > 0 && (
            <div className="mt-4 pt-3 hairline-t">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                aria-label={showArchived ? "Hide archived habits" : "Show archived habits"}
                className="flex min-h-[44px] w-full items-center justify-between px-2 t-label font-medium text-ink-2 hover:text-ink"
              >
                <span>Archived habits ({archivedHabits.length})</span>
                <ChevronIcon open={showArchived} />
              </button>

              {showArchived && (
                <div className="mt-2 group-list bg-wash">
                  {archivedHabits.map((habit, idx) => (
                    <div
                      key={habit.id}
                      className={`group-row flex-col justify-center p-2.5 ${
                        idx > 0 ? "group-row-sep" : ""
                      }`}
                    >
                      {confirmDeleteId === habit.id ? (
                        <div className="flex w-full flex-col gap-2 p-1">
                          <p className="t-label font-medium text-signal">
                            Delete habit and all its history?
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                deleteHabit(habit.id);
                                setConfirmDeleteId(null);
                              }}
                              className="min-h-[44px] flex-1 bg-signal px-3 t-label font-semibold text-white"
                            >
                              Delete history
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[44px] flex-1 bg-wash px-3 t-label font-medium text-ink-2"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 t-body text-ink-2">{habit.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setHabitArchived(habit.id, false)}
                              aria-label={`Unarchive ${habit.name}`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-ink"
                              title="Unarchive"
                            >
                              <UnarchiveIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(habit.id)}
                              aria-label={`Delete ${habit.name}`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-signal"
                              title="Delete"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
