import { estimated1RM, type Exercise, type WorkoutSet } from "./store";

// ---------------------------------------------------------------------------
// Pure PR/progress detection (PRD §7.7). No React, no store, no IndexedDB, no
// DOM — takes plain arrays and a fixed `now`, returns plain data. Detection
// is scoped to the just-ended session (evaluated at End Workout), compared
// against rolling weekly/monthly baselines built from every OTHER set the
// exercise has ever had — never all-time PRs.
// ---------------------------------------------------------------------------

const DAY = 86400000;

export type PRKind = "e1rm" | "reps";
export type PRWindow = "week" | "month";

export interface DetectedPR {
  exerciseId: string;
  exerciseName: string;
  kind: PRKind;
  window: PRWindow;
}

function max(values: number[]): number {
  return values.reduce((m, v) => (v > m ? v : m), -Infinity);
}

/**
 * Detects PRs set by `sessionSets` against rolling week/month baselines built
 * from every other set of the same exercise (`allSets` minus `sessionSets`,
 * by id). Windows are anchored to `now`:
 *   - week:  loggedAt >= now - 7*DAY  (inclusive)
 *   - month: loggedAt >= now - 30*DAY (inclusive)
 * A PR only fires when a prior baseline exists in that window — a first-ever
 * session with nothing to beat is not a "progressed" event. Per exercise, the
 * strongest single claim wins: month beats week, and — within the same
 * window — an e1RM PR is reported before a reps PR.
 */
export function detectSessionPRs(args: {
  sessionSets: WorkoutSet[];
  allSets: WorkoutSet[];
  exercises: Exercise[];
  now: number;
}): DetectedPR[] {
  const { sessionSets, allSets, exercises, now } = args;
  const weekStart = now - 7 * DAY;
  const monthStart = now - 30 * DAY;
  const sessionSetIds = new Set(sessionSets.map((s) => s.id));
  const exerciseName = (id: string) => exercises.find((e) => e.id === id)?.name ?? "Exercise";

  const exerciseIds = Array.from(new Set(sessionSets.map((s) => s.exerciseId)));
  const results: DetectedPR[] = [];

  for (const exerciseId of exerciseIds) {
    const sessSetsForExercise = sessionSets.filter((s) => s.exerciseId === exerciseId);

    const priorForExercise = allSets.filter(
      (s) => s.exerciseId === exerciseId && !sessionSetIds.has(s.id),
    );
    const priorWeek = priorForExercise.filter((s) => s.loggedAt >= weekStart);
    const priorMonth = priorForExercise.filter((s) => s.loggedAt >= monthStart);

    // --- e1RM best -----------------------------------------------------
    const bestSessionE1RM = max(sessSetsForExercise.map((s) => estimated1RM(s.weight, s.reps)));

    let e1rmWindow: PRWindow | null = null;
    if (priorMonth.length > 0) {
      const bestMonthE1RM = max(priorMonth.map((s) => estimated1RM(s.weight, s.reps)));
      if (bestSessionE1RM > bestMonthE1RM) e1rmWindow = "month";
    }
    if (!e1rmWindow && priorWeek.length > 0) {
      const bestWeekE1RM = max(priorWeek.map((s) => estimated1RM(s.weight, s.reps)));
      if (bestSessionE1RM > bestWeekE1RM) e1rmWindow = "week";
    }

    // --- rep-at-exact-weight best ---------------------------------------
    let repsWindow: PRWindow | null = null;
    const weights = Array.from(new Set(sessSetsForExercise.map((s) => s.weight)));
    for (const weight of weights) {
      const bestSessionReps = max(
        sessSetsForExercise.filter((s) => s.weight === weight).map((s) => s.reps),
      );
      const priorMonthAtWeight = priorMonth.filter((s) => s.weight === weight);
      const priorWeekAtWeight = priorWeek.filter((s) => s.weight === weight);

      let thisWeightWindow: PRWindow | null = null;
      if (priorMonthAtWeight.length > 0) {
        const bestMonthReps = max(priorMonthAtWeight.map((s) => s.reps));
        if (bestSessionReps > bestMonthReps) thisWeightWindow = "month";
      }
      if (!thisWeightWindow && priorWeekAtWeight.length > 0) {
        const bestWeekReps = max(priorWeekAtWeight.map((s) => s.reps));
        if (bestSessionReps > bestWeekReps) thisWeightWindow = "week";
      }

      if (thisWeightWindow === "month") {
        repsWindow = "month";
        break; // month is the strongest possible claim — no need to keep looking
      } else if (thisWeightWindow === "week" && repsWindow !== "month") {
        repsWindow = "week";
      }
    }

    // --- pick the strongest single claim: month beats week; e1RM first --
    let kind: PRKind | null = null;
    let window: PRWindow | null = null;
    if (e1rmWindow === "month") {
      kind = "e1rm";
      window = "month";
    } else if (repsWindow === "month") {
      kind = "reps";
      window = "month";
    } else if (e1rmWindow === "week") {
      kind = "e1rm";
      window = "week";
    } else if (repsWindow === "week") {
      kind = "reps";
      window = "week";
    }

    if (kind && window) {
      results.push({ exerciseId, exerciseName: exerciseName(exerciseId), kind, window });
    }
  }

  return results;
}

const claimRank = (pr: DetectedPR): number => {
  if (pr.window === "month" && pr.kind === "e1rm") return 0;
  if (pr.window === "month" && pr.kind === "reps") return 1;
  if (pr.window === "week" && pr.kind === "e1rm") return 2;
  return 3;
};

/**
 * Turns detected PRs into one short, plain-ASCII toast line naming the
 * exercise and window. If several exercises PR'd, names the single most
 * notable claim (month beats week; e1RM beats reps). Returns null for an
 * empty list.
 */
export function formatPRMessage(prs: DetectedPR[]): string | null {
  if (prs.length === 0) return null;
  const top = [...prs].sort((a, b) => claimRank(a) - claimRank(b))[0];
  const label = top.kind === "e1rm" ? "best estimated 1RM" : "rep best";
  return `${top.exerciseName}: ${label} this ${top.window}`;
}
