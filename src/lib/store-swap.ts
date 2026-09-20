import { useStore } from "./store";

/**
 * The slice of main-store state a client's snapshot replaces.
 *
 * Listed explicitly rather than spread, so that a field added to the store
 * later is a compile error here if it should travel, and silently left alone if
 * it should not.
 */
export const SWAPPED_KEYS = [
  "exercises",
  "slots",
  "sessions",
  "sets",
  "dailyLogs",
  "nutritionPhases",
  "plannedDays",
  "unit",
  "activeSessionId",
  "currentExerciseId",
  "nextSlotId",
  "restSince",
  "lastAcceptedPlanAt",
  // Swapped so the COACH can edit a client's plan even when the coach is
  // coached themselves -- and so the client's own flag never reaches here.
  "coachManaged",
] as const;

export type SwappedKey = (typeof SWAPPED_KEYS)[number];
export type Swapped = Pick<ReturnType<typeof useStore.getState>, SwappedKey>;

export function captureOwnState(): Swapped {
  const state = useStore.getState();
  const out = {} as Record<string, unknown>;
  for (const key of SWAPPED_KEYS) out[key] = state[key];
  return out as Swapped;
}
