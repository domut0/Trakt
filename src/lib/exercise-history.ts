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
 * The most recent OTHER session that trained this exercise.
 *
 * What "last session" means between sets: the last time you did this lift, not
 * the last set you did of it. `excludeSessionId` is what keeps the workout in
 * progress out of its own answer - without it, the moment you log a set the
 * card would start showing the session you are standing in.
 *
 * Sets come back in the order they were logged, because "set 1, set 2, set 3"
 * is the thing being read, and a list sorted by weight would renumber the
 * session.
 */
export function lastSessionFor(
  sets: WorkoutSet[],
  sessions: WorkoutSession[],
  exerciseId: string,
  excludeSessionId?: string,
): GroupedSessionSets | undefined {
  const forExercise = setsForExercise(sets, exerciseId, sessions).filter(
    (s) => s.sessionId !== excludeSessionId,
  );
  return groupSetsBySession(forExercise, sessions)[0];
}
