import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { type Meal } from "../lib/food";
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
      aria-hidden="true"
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
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <polyline points="19 12 12 19 5 12" />
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
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function toTimeString(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fromTimeString(str: string): number {
  const [hStr, mStr] = str.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return ((h % 24) * 60 + (m % 60)) % 1440;
}

/**
 * Meal slot manager sheet.
 *
 * Allows adding, renaming, reordering, deleting, and setting time windows for
 * meals. When deleting a meal, entries are reassigned to the fallback meal
 * rather than being deleted. Deleting the last meal is refused.
 */
export function MealsEditorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meals = useStore((s) => s.meals);
  const addMeal = useStore((s) => s.addMeal);
  const renameMeal = useStore((s) => s.renameMeal);
  const deleteMeal = useStore((s) => s.deleteMeal);
  const setMealWindow = useStore((s) => s.setMealWindow);
  const reorderMeals = useStore((s) => s.reorderMeals);
  const seedMealsIfEmpty = useStore((s) => s.seedMealsIfEmpty);

  const [newMealName, setNewMealName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    seedMealsIfEmpty();
    setNewMealName("");
    setEditingId(null);
    setConfirmDeleteId(null);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [open, seedMealsIfEmpty]);

  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const sortedMeals = [...meals].sort((a, b) => a.rank - b.rank);

  const handleAdd = () => {
    const trimmed = newMealName.trim();
    if (!trimmed) return;
    addMeal(trimmed);
    setNewMealName("");
    inputRef.current?.focus();
  };

  const commitRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      renameMeal(id, trimmed);
    }
    setEditingId(null);
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const current = sortedMeals[index];
    const prev = sortedMeals[index - 1];
    reorderMeals(current.id, prev.id);
  };

  const moveDown = (index: number) => {
    if (index >= sortedMeals.length - 1) return;
    const current = sortedMeals[index];
    const next = sortedMeals[index + 1];
    reorderMeals(current.id, next.id);
  };

  const getFallbackMeal = (id: string): Meal | undefined => {
    return sortedMeals.find((m) => m.id !== id);
  };

  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-3xl bg-surface p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <h2 className="t-heading font-semibold tracking-tight">Manage meals</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label font-medium text-muted-foreground hover:text-foreground"
          >
            Done
          </button>
        </div>

        {/* Add new meal input */}
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
              aria-label="Meal name"
              value={newMealName}
              onChange={(e) => setNewMealName(e.target.value)}
              placeholder="Add meal (e.g. Snack)"
              className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 t-body outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={!newMealName.trim()}
              className="min-h-[44px] rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </div>

        {/* Scrollable list of meals */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {sortedMeals.length === 0 ? (
            <p className="py-4 text-center t-label text-muted-foreground">
              No meals configured. Add one above.
            </p>
          ) : (
            <div className="group-list bg-muted">
              {sortedMeals.map((meal, idx) => {
                const isAllDay = meal.fromMinutes === meal.toMinutes;
                const fallback = getFallbackMeal(meal.id);

                return (
                  <div
                    key={meal.id}
                    className={`group-row flex-col justify-center p-3 ${
                      idx > 0 ? "group-row-sep" : ""
                    }`}
                  >
                    {confirmDeleteId === meal.id ? (
                      <div className="flex w-full flex-col gap-2 p-1">
                        <p className="t-label font-medium text-destructive">
                          {fallback
                            ? `Delete meal? Entries will move to ${fallback.name}.`
                            : "Cannot delete the last remaining meal."}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              deleteMeal(meal.id);
                              setConfirmDeleteId(null);
                            }}
                            className="min-h-[44px] flex-1 rounded-lg bg-destructive px-3 t-label font-semibold text-white"
                          >
                            Delete meal
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-[44px] flex-1 rounded-lg bg-muted px-3 t-label font-medium text-muted-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex w-full flex-col gap-2">
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {editingId === meal.id ? (
                              <input
                                autoFocus
                                type="text"
                                aria-label="Edit meal name"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={() => commitRename(meal.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRename(meal.id);
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingId(null);
                                  }
                                }}
                                className="w-full rounded bg-surface px-2 py-1 t-body font-medium text-foreground outline-none ring-1 ring-accent"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(meal.id);
                                  setEditingName(meal.name);
                                }}
                                aria-label={`Rename ${meal.name}`}
                                className="flex min-h-[44px] w-full items-center text-left t-body font-medium text-foreground hover:text-accent"
                                title="Tap to rename"
                              >
                                <span className="truncate">{meal.name}</span>
                              </button>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              aria-label={`Move ${meal.name} up`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowUpIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveDown(idx)}
                              disabled={idx === sortedMeals.length - 1}
                              aria-label={`Move ${meal.name} down`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowDownIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(meal.id)}
                              disabled={sortedMeals.length <= 1}
                              aria-label={
                                sortedMeals.length <= 1
                                  ? "Cannot delete only meal"
                                  : `Delete ${meal.name}`
                              }
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface hover:text-destructive disabled:opacity-30"
                              title={
                                sortedMeals.length <= 1 ? "Cannot delete only meal" : "Delete meal"
                              }
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>

                        {/* Time window editor */}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          {isAllDay ? (
                            <div className="flex items-center gap-2">
                              <span className="t-label text-muted-foreground">All day</span>
                              <button
                                type="button"
                                onClick={() => setMealWindow(meal.id, 8 * 60, 12 * 60)}
                                className="flex min-h-[44px] items-center px-1 t-label font-medium text-accent hover:underline"
                              >
                                Set hours
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="time"
                                aria-label={`${meal.name} start time`}
                                value={toTimeString(meal.fromMinutes)}
                                onChange={(e) => {
                                  const from = fromTimeString(e.target.value);
                                  setMealWindow(meal.id, from, meal.toMinutes);
                                }}
                                className="min-h-[44px] rounded-lg bg-surface px-2 py-1 t-label text-foreground outline-none ring-1 ring-border focus:ring-accent"
                              />
                              <span className="t-label text-muted-foreground">to</span>
                              <input
                                type="time"
                                aria-label={`${meal.name} end time`}
                                value={toTimeString(meal.toMinutes)}
                                onChange={(e) => {
                                  const to = fromTimeString(e.target.value);
                                  setMealWindow(meal.id, meal.fromMinutes, to);
                                }}
                                className="min-h-[44px] rounded-lg bg-surface px-2 py-1 t-label text-foreground outline-none ring-1 ring-border focus:ring-accent"
                              />
                              <button
                                type="button"
                                onClick={() => setMealWindow(meal.id, 0, 0)}
                                className="flex min-h-[44px] items-center px-2 t-label font-medium text-muted-foreground hover:text-foreground"
                              >
                                Make all day
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
