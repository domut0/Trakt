import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { DeleteWorkoutButton } from "../components/DeleteWorkoutButton";
import { SessionView } from "../components/SessionView";
import { useStore } from "../lib/store";

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
  const slot = useStore((s) =>
    session ? s.slots.find((sl) => sl.id === session.splitSlotId) : undefined,
  );

  if (!session || !slot) {
    return (
      <AppShell>
        <div className="px-6 py-20 text-center text-muted-foreground">Session not found.</div>
      </AppShell>
    );
  }

  const d = new Date(session.endedAt ?? session.startedAt);

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-14 pb-2">
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="text-[15px] font-medium text-accent"
        >
          Back
        </button>
        <DeleteWorkoutButton
          sessionId={session.id}
          onDeleted={() => router.navigate({ to: "/" })}
        />
      </div>
      <header className="px-5 pb-2">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">{slot.name}</h1>
      </header>
      <SessionView sessionId={session.id} />
    </AppShell>
  );
}
