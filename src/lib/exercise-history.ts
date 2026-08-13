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
 *
 * Takes sets, not sessions, so it cannot apply the cardio guard itself. Feed it
 * the output of `setsForExercise`, which can only return strength sets - that is
 * the whole reason `setsForExercise` takes `sessions` as a required argument
 * rather than an optional one. Passing a raw `state.sets` slice here would put a
 * treadmill entry into a personal best.
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
 *
 * Same contract as `bestSetFor`: strength-only is the caller's job, discharged
 * by passing the output of `setsForExercise`.
 */
export function volumeFor(sets: WorkoutSet[]): number {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
}

/**
 * Finds the exercise IDs logged during the previous strength session of the same split slot,
 * maintaining the original logged order.
 *
 * The same two guards as `findLastSessionForSlot` in store.ts, applied to BOTH
 * sides of every comparison: cardio is excluded outright, and a session with no
 * `splitSlotId` never matches anything. Without the second guard two cardio
 * bouts, which both carry `splitSlotId === undefined`, would compare equal to
 * each other and to any other slot-less session, and a treadmill run would
 * start feeding this list.
 *
 * "Previous" means strictly earlier, by `startedAt`. Both halves of that matter:
 *
 * - Strictly earlier, because this is called for a session being VIEWED, not
 *   only for the live one. `/session/$id` renders the same SessionView as
 *   `/workout`, so without a `startedAt` comparison, opening last Monday's
 *   session offered the exercise list from the FOLLOWING Monday.
 * - By `startedAt`, not `endedAt`, matching every surface that buckets or
 *   orders sessions by date (see `countSessionsTrained` in daily-log.ts). A
 *   session that began earlier is the earlier session even if it ran long.
 *
 * `endedAt != null` is a separate, deliberate filter: an abandoned session is
 * not something to pull a plan from. This is exactly the completeness/ordering
 * split that `countSessionsTrained` documents.
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
        s.endedAt != null &&
        s.startedAt < currentSession.startedAt,
    )
    .sort((a, b) => b.startedAt - a.startedAt);

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
