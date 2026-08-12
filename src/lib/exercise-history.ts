import type { WorkoutSession, WorkoutSet } from "./store";

/**
 * Pure helper utilities for querying exercise history and set aggregation.
 * No React, no DOM, no Zustand store imports (type-only imports to prevent runtime cycles).
 */

/**
 * Single source of truth for cardio session identification in exercise history heuristics.
 * A session is cardio when `kind === "cardio"`. An absent `kind` indicates a strength session.
 */
function isCardio(session: WorkoutSession): boolean {
  return session.kind === "cardio";
}

export interface GroupedSessionSets {
  session: WorkoutSession;
  date: Date;
  sets: WorkoutSet[];
}

/**
 * Returns sets for a specific exercise ID, ordered newest first by loggedAt timestamp.
 *
 * `sessions` is REQUIRED, not optional: a set is only returned once its session
 * has been found and confirmed to be strength. Making the guard skippable is how
 * a treadmill entry ends up in a personal-best calculation, so there is no
 * overload that omits it. This is also what keeps a "total sets" count derived
 * from this function consistent with `groupSetsBySession`, which applies the
 * same rule.
 */
export function setsForExercise(
  sets: WorkoutSet[],
  exerciseId: string,
  sessions: WorkoutSession[],
): WorkoutSet[] {
  const strengthSessionIds = new Set(
    sessions.filter((sess) => !isCardio(sess)).map((sess) => sess.id),
  );
  return sets
    .filter((s) => s.exerciseId === exerciseId && strengthSessionIds.has(s.sessionId))
    .sort((a, b) => b.loggedAt - a.loggedAt);
}

/**
 * Groups sets by strength session for exercise history timelines.
 * Excludes cardio sessions entirely. Returns one entry per session containing sets,
 * ordered newest session first (by startedAt). Sets within each session are ordered
 * chronologically by loggedAt (oldest to newest).
 */
export function groupSetsBySession(
  sets: WorkoutSet[],
  sessions: WorkoutSession[],
): GroupedSessionSets[] {
  const strengthSessionsMap = new Map<string, WorkoutSession>();
  for (const s of sessions) {
    if (!isCardio(s)) {
      strengthSessionsMap.set(s.id, s);
    }
  }

  const bySession = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    if (strengthSessionsMap.has(set.sessionId)) {
      const arr = bySession.get(set.sessionId);
      if (arr) {
        arr.push(set);
      } else {
        bySession.set(set.sessionId, [set]);
      }
    }
  }

  const result: GroupedSessionSets[] = [];
  for (const [sessionId, sessionSets] of bySession.entries()) {
    const session = strengthSessionsMap.get(sessionId)!;
    const sortedSets = [...sessionSets].sort((a, b) => a.loggedAt - b.loggedAt);
    result.push({
      session,
      date: new Date(session.startedAt),
      sets: sortedSets,
    });
  }

  return result.sort((a, b) => b.session.startedAt - a.session.startedAt);
}

/**
 * Finds the heaviest set logged for an exercise, breaking ties by higher reps.
 * Returns undefined when the set list is empty.
 */
export function bestSetFor(sets: WorkoutSet[]): WorkoutSet | undefined {
  if (sets.length === 0) return undefined;
  return sets.reduce((best, current) => {
    if (current.weight > best.weight) return current;
    if (current.weight === best.weight && current.reps > best.reps) return current;
    return best;
  });
}

/**
 * Returns total volume (sum of weight * reps across all sets).
 */
export function volumeFor(sets: WorkoutSet[]): number {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
}

/**
 * Finds the exercise IDs logged during the previous strength session of the same split slot,
 * maintaining the original logged order.
 *
 * Excludes cardio sessions and ensures sessions with undefined splitSlotId never match each other,
 * preventing unslotted sessions from leaking exercise lists into each other.
 */
export function previousSessionExerciseOrder(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
): string[] {
  const currentSession = sessions.find((s) => s.id === sessionId);
  if (!currentSession || isCardio(currentSession) || currentSession.splitSlotId == null) {
    return [];
  }

  const matchingSessions = sessions
    .filter(
      (s) =>
        !isCardio(s) &&
        s.splitSlotId != null &&
        s.splitSlotId === currentSession.splitSlotId &&
        s.id !== currentSession.id &&
        (s.endedAt != null || s.startedAt < currentSession.startedAt),
    )
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));

  if (matchingSessions.length === 0) {
    return [];
  }

  const prevSession = matchingSessions[0];
  const prevSets = sets
    .filter((s) => s.sessionId === prevSession.id)
    .sort((a, b) => a.loggedAt - b.loggedAt);

  const order: string[] = [];
  for (const s of prevSets) {
    if (!order.includes(s.exerciseId)) {
      order.push(s.exerciseId);
    }
  }

  return order;
}
