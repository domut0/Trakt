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
        <div className="px-6 py-20 text-center text-muted-foreground">Exercise not found.</div>
      </AppShell>
    );
  }

  const exSets = setsForExercise(allSets, exercise.id, sessions);
  const best = bestSetFor(exSets);
  const grouped = groupSetsBySession(exSets, sessions);

  const typeLabel =
    exercise.type === "main" ? "Main Lift" : exercise.type === "cardio" ? "Cardio" : "Accessory";

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-14 pb-2">
        {/* The negative vertical margin is what lets a 22px line of text carry a
            44px touch target without pushing the title down: 44 - 2*11 = 22, so
            the row occupies exactly the height it did before. */}
        <button
          onClick={goBack}
          className="-my-[11px] flex min-h-[44px] items-center text-[15px] font-medium text-accent"
        >
          Back
        </button>
      </div>

      <header className="px-5 pb-4">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {typeLabel}
        </div>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">{exercise.name}</h1>
        {exercise.setupNote && (
          <div className="mt-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            {exercise.setupNote}
          </div>
        )}
      </header>

      {/* Personal bests and set totals */}
      <div className="px-5 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Best Set
            </div>
            <div className="tnum mt-1 text-[20px] font-semibold tracking-tight">
              {best ? (
                <>
                  {best.weight}{" "}
                  <span className="text-[13px] font-normal text-muted-foreground">{unit}</span>
                  {" × "}
                  {best.reps}
                  {best.rpe != null && (
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {" "}
                      @ {best.rpe}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[15px] font-normal text-muted-foreground">None</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-surface p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Total Sets
            </div>
            <div className="tnum mt-1 text-[20px] font-semibold tracking-tight">
              {exSets.length}
            </div>
          </div>
        </div>
      </div>

      {/* Chronological per-session history */}
      <section className="px-5 pb-10">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
          History
        </h2>

        {grouped.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 text-center">
            <h3 className="text-[16px] font-semibold tracking-tight">No history logged</h3>
            {/* A cardio exercise can never fill this screen: `logCardio` writes a
                session with duration and distance and no sets at all, so telling
                someone to log sets for it would be advice that cannot be
                followed. */}
            <p className="mt-1 text-[13px] text-muted-foreground">
              {exercise.type === "cardio"
                ? `${exercise.name} is logged as a bout with duration and distance rather than sets. Those appear on the History tab.`
                : `Log sets for ${exercise.name} during a workout to track your progress here.`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ session, date, sets }) => (
              <div key={session.id} className="rounded-2xl bg-surface p-4">
                <div className="flex items-baseline justify-between border-b border-border pb-2.5 mb-2.5">
                  <span className="text-[14px] font-semibold tracking-tight">
                    {date.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {sets.length} {sets.length === 1 ? "set" : "sets"}
                  </span>
                </div>
                <div className="space-y-2">
                  {sets.map((s, idx) => (
                    <div key={s.id} className="flex items-center justify-between text-[15px]">
                      <div className="flex items-baseline gap-2">
                        <span className="tnum w-5 text-[13px] text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="tnum font-medium">
                          {s.weight}{" "}
                          <span className="text-[12px] text-muted-foreground">{unit}</span> ×{" "}
                          {s.reps}
                        </span>
                        {s.rpe != null && (
                          <span className="tnum text-[13px] text-muted-foreground">@ {s.rpe}</span>
                        )}
                        {s.isDropsetOrPartial && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
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
