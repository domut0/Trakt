import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { SessionView } from "../components/SessionView";
import { isCardioSession, sessionSlotName, useStore } from "../lib/store";

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
        <div className="px-4 py-20 text-center t-body text-ink-2">Session not found.</div>
      </AppShell>
    );
  }

  const isCardio = isCardioSession(session);
  // A session whose card was deleted is still a session: it opens under the
  // name it was logged with, rather than as "not found".
  const slotName = !isCardio ? sessionSlotName(session, slots) : undefined;
  const cardioEx = isCardio ? exercises.find((e) => e.id === session.cardioExerciseId) : undefined;

  if (!isCardio && session.splitSlotId == null) {
    return (
      <AppShell>
        <div className="px-4 py-20 text-center t-body text-ink-2">Session not found.</div>
      </AppShell>
    );
  }

  const title = isCardio ? (cardioEx?.name ?? "Cardio") : (slotName ?? "Untitled");
  const d = new Date(session.startedAt);

  return (
    <AppShell>
      <div className="flex items-center justify-between px-4 pt-14 pb-2">
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="-my-3 flex min-h-[44px] items-center t-body font-medium t-action"
        >
          Back
        </button>
        <DeleteWorkoutButton
          sessionId={session.id}
          onDeleted={() => router.navigate({ to: "/" })}
        />
      </div>
      <header className="px-4 pb-2">
        <div className="t-caption text-ink-2">
          {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 className="mt-1 text-balance break-words t-title">{title}</h1>
      </header>
      {isCardio ? (
        <div className="section-gap px-4">
          <div className="group-list">
            {session.durationMinutes != null && (
              <div className="group-row">
                <span className="t-body text-ink-2">Duration</span>
                <span className="t-stat">
                  {session.durationMinutes} <span className="t-label text-ink-2">min</span>
                </span>
              </div>
            )}
            {session.distance != null && (
              <div
                className={`group-row ${session.durationMinutes != null ? "group-row-sep" : ""}`}
              >
                <span className="t-body text-ink-2">Distance</span>
                <span className="t-stat">
                  {session.distance}{" "}
                  <span className="t-label text-ink-2">{unit === "lbs" ? "mi" : "km"}</span>
                </span>
              </div>
            )}
            {session.setupNote && (
              <div
                className={`group-row flex-col items-start ${
                  session.durationMinutes != null || session.distance != null ? "group-row-sep" : ""
                }`}
              >
                <span className="t-caption text-ink-2">Notes</span>
                <div className="mt-1 t-body text-ink whitespace-pre-wrap">{session.setupNote}</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <SessionView sessionId={session.id} />
      )}
    </AppShell>
  );
}
