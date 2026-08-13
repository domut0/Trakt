import { createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { bestSetFor, groupSetsBySession, setsForExercise } from "../lib/exercise-history";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/exercise/$id")({
  head: () => ({
    meta: [
      { title: "Exercise History" },
      { name: "description", content: "Exercise history and personal records." },
    ],
  }),
  component: ExercisePage,
});

function ExercisePage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const exercise = useStore((s) => s.exercises.find((x) => x.id === id));
  const allSets = useStore((s) => s.sets);
  const sessions = useStore((s) => s.sessions);
  const unit = useStore((s) => s.unit);

  // This page is only ever reached from SessionView, which renders inside both
  // /workout and /session/$id. A hardcoded navigate to "/" therefore threw the
  // user out of an in-progress workout screen instead of returning them to it.
  // The history entry only exists when they actually navigated here, so a
  // deep-link or refresh still needs the Today fallback.
  const goBack = () => {
    if (canGoBack) router.history.back();
    else router.navigate({ to: "/" });
  };

  if (!exercise) {
    return (
      <AppShell>
        <div className="px-5 py-20 text-center t-body text-muted-foreground">
          Exercise not found.
        </div>
      </AppShell>
    );
  }

  const exSets = setsForExercise(allSets, exercise.id, sessions);
  const best = bestSetFor(exSets);
  const grouped = groupSetsBySession(exSets, sessions);

  const typeLabel =
    exercise.type === "main" ? "Main lift" : exercise.type === "cardio" ? "Cardio" : "Accessory";

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-14 pb-2">
        <button
          onClick={goBack}
          className="-my-[11px] flex min-h-[44px] items-center t-body font-medium text-accent"
        >
          Back
        </button>
      </div>

      <header className="px-5 pb-4">
        <div className="t-caption text-muted-foreground">
          {typeLabel}
        </div>
        <h1 className="mt-1 text-balance break-words t-title">
          {exercise.name}
        </h1>
        {exercise.setupNote && (
          <div className="mt-2 rounded-lg bg-muted px-3 py-2 t-label text-muted-foreground">
            {exercise.setupNote}
          </div>
        )}
      </header>

      {/* Personal bests and set totals */}
      <div className="px-5">
        <div className="group-list">
          <div className="group-row">
            <span className="t-body text-muted-foreground">Best set</span>
            <span className="t-stat">
              {best ? (
                <>
                  {best.weight}{" "}
                  <span className="t-label text-muted-foreground">{unit}</span>
                  {" × "}
                  {best.reps}
                  {best.rpe != null && (
                    <span className="t-label text-muted-foreground"> @ {best.rpe}</span>
                  )}
                </>
              ) : (
                <span className="t-body text-muted-foreground">None</span>
              )}
            </span>
          </div>
          <div className="group-row group-row-sep">
            <span className="t-body text-muted-foreground">Total sets</span>
            <span className="t-stat">{exSets.length}</span>
          </div>
        </div>
      </div>

      {/* Chronological per-session history */}
      <section className="section-gap px-5 pb-10">
        <h2 className="group-header px-0 t-caption">
          History
        </h2>

        {grouped.length === 0 ? (
          <div className="group-list p-6 text-center">
            <h3 className="t-heading">No history logged</h3>
            <p className="mt-1 t-label text-muted-foreground">
              {exercise.type === "cardio"
                ? `${exercise.name} is logged as a bout with duration and distance rather than sets. Those appear on the History tab.`
                : `Log sets for ${exercise.name} during a workout to track your progress here.`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ session, date, sets }) => (
              <div key={session.id}>
                <div className="group-header flex items-baseline justify-between px-0 pb-2">
                  <span className="t-body font-semibold text-foreground">
                    {date.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="t-label text-muted-foreground">
                    {sets.length} {sets.length === 1 ? "set" : "sets"}
                  </span>
                </div>
                <div className="group-list">
                  {sets.map((s, idx) => (
                    <div
                      key={s.id}
                      className={`group-row ${idx > 0 ? "group-row-sep" : ""}`}
                    >
                      <div className="flex min-w-0 flex-wrap items-baseline gap-3">
                        <span className="t-label w-5 shrink-0 text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="t-stat">
                          {s.weight}
                          <span className="t-label text-muted-foreground"> {unit}</span>
                        </span>
                        <span className="text-muted-foreground">×</span>
                        <span className="t-stat">{s.reps}</span>
                        {s.rpe != null && (
                          <span className="t-label text-muted-foreground">@ {s.rpe}</span>
                        )}
                        {s.isDropsetOrPartial && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 t-caption text-muted-foreground">
                            drop
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
