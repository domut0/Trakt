import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { SessionView } from "../components/SessionView";
import { isCardioSession, useStore } from "../lib/store";

export const Route = createFileRoute("/session/$id")({
  head: () => ({
    meta: [{ title: "Session" }, { name: "description", content: "Logged workout session." }],
  }),
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const session = useStore((s) => s.sessions.find((x) => x.id === id));
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const unit = useStore((s) => s.unit);

  if (!session) {
    return (
      <AppShell>
        <div className="px-5 py-20 text-center text-[15px] text-muted-foreground">
          Session not found.
        </div>
      </AppShell>
    );
  }

  const isCardio = isCardioSession(session);
  const slot = !isCardio ? slots.find((sl) => sl.id === session.splitSlotId) : undefined;
  const cardioEx = isCardio ? exercises.find((e) => e.id === session.cardioExerciseId) : undefined;

  if (!isCardio && !slot) {
    return (
      <AppShell>
        <div className="px-5 py-20 text-center text-[15px] text-muted-foreground">
          Session not found.
        </div>
      </AppShell>
    );
  }

  const title = isCardio ? (cardioEx?.name ?? "Cardio") : slot!.name;
  const d = new Date(session.startedAt);

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-14 pb-2">
        {/* The negative vertical margin is what lets a 20px line of text carry a
            44px touch target without pushing the header down: 44 - 2*12 = 20, so
            the row occupies exactly the height it did before. */}
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="-my-3 flex min-h-[44px] items-center text-[15px] font-medium text-accent"
        >
          Back
        </button>
        <DeleteWorkoutButton
          sessionId={session.id}
          onDeleted={() => router.navigate({ to: "/" })}
        />
      </div>
      <header className="px-5 pb-2">
        <div className="tnum text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 className="mt-1 text-balance break-words text-[30px] font-semibold tracking-tight">
          {title}
        </h1>
      </header>
      {isCardio ? (
        <div className="mt-4 px-5 space-y-4">
          {(session.durationMinutes != null || session.distance != null) && (
            <div className="flex gap-3">
              {session.durationMinutes != null && (
                <div className="min-w-0 flex-1 rounded-2xl bg-surface p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Duration
                  </div>
                  <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">
                    {session.durationMinutes}{" "}
                    <span className="text-[14px] font-normal text-muted-foreground">min</span>
                  </div>
                </div>
              )}
              {session.distance != null && (
                <div className="min-w-0 flex-1 rounded-2xl bg-surface p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Distance
                  </div>
                  <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">
                    {session.distance}{" "}
                    <span className="text-[14px] font-normal text-muted-foreground">
                      {unit === "lbs" ? "mi" : "km"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          {session.setupNote && (
            <div className="rounded-2xl bg-surface p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Notes
              </div>
              <div className="mt-1 text-[15px] text-foreground whitespace-pre-wrap">
                {session.setupNote}
              </div>
            </div>
          )}
        </div>
      ) : (
        <SessionView sessionId={session.id} />
      )}
    </AppShell>
  );
}
