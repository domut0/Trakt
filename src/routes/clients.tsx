import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { CoachClients } from "../components/CoachClients";
import { clientsSearch } from "../lib/coach-progress-search";

export const Route = createFileRoute("/clients")({
  validateSearch: clientsSearch,
  head: () => ({ meta: [{ title: "Clients · Trakt" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  return (
    <AppShell>
      <CoachClients search={Route.useSearch()} />
    </AppShell>
  );
}
