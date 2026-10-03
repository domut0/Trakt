import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Flame, Footprints, Settings } from "lucide-react";
import { useCoachStore } from "../lib/coach-store";
import { useCoachProgressStore, type ProgressEntry } from "../lib/coach-progress-store";
import { progressDays, progressWeeks, shiftProgressAnchor } from "../lib/coach-progress";
import { dayKey, parseDayKey } from "../lib/daily-log";
import { warmGoogleAuth } from "../lib/google-auth";
import { freshness } from "./ClientBanner";
import { CoachProgressCalendar, CoachProgressDay } from "./CoachProgressCalendar";
import { progressErrorMessage, type ClientsSearch } from "../lib/coach-progress-search";

function SnapshotStatus({
  entry,
  onRefresh,
  refreshing,
}: {
  entry?: ProgressEntry;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-2">
          {entry?.fetchedAt !== undefined ? `Fetched ${freshness(entry.fetchedAt)}` : "Not fetched"}
        </span>
        <button
          type="button"
          disabled={refreshing}
          className="min-h-11 px-2 text-[12px] t-action disabled:text-ink-3"
          onClick={onRefresh}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {entry?.error && (
        <p className="text-[11px] text-signal" role="status">
          {progressErrorMessage(entry.error)}
          {entry.snapshot ? ". Showing the last fetched data" : ""}
        </p>
      )}
    </div>
  );
}

function ClientCalendar({
  clientId,
  name,
  entry,
  weeks,
  onDay,
}: {
  clientId: string;
  name: string;
  entry?: ProgressEntry;
  weeks: (string | null)[][];
  onDay: (clientId: string, date: string) => void;
}) {
  const days = useMemo(
    () => (entry?.snapshot ? progressDays(entry.snapshot) : new Map()),
    [entry?.snapshot],
  );
  return (
    <>
      {entry?.snapshot ? (
        <CoachProgressCalendar
          weeks={weeks}
          days={days}
          unit={entry.snapshot.unit}
          clientName={name}
          onSelectDay={(date) => onDay(clientId, date)}
        />
      ) : (
        <p className="rounded-md bg-surface p-3 text-[12px] text-ink-2" role="status">
          {entry?.loading
            ? "Reading client's sheet…"
            : entry?.error
              ? "Calendar unavailable"
              : "Waiting to read this client's sheet"}
        </p>
      )}
      {entry?.error && (
        <p className="mt-2 text-[11px] text-signal" role="status">
          {progressErrorMessage(entry.error)}
          {entry.snapshot ? ". Showing the last fetched data" : ""}
        </p>
      )}
    </>
  );
}

export function CoachClients({ search }: { search: ClientsSearch }) {
  const navigate = useNavigate({ from: "/clients" });
  const { clients, hydrated, enabled, hydrate, viewing, enterClientView, loading, lastError } =
    useCoachStore();
  const { entries, refreshing, refresh, retainClients } = useCoachProgressStore();
  const [hydrateError, setHydrateError] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const restoreDay = useRef<{ clientId: string; date: string } | null>(null);
  const rosterScroll = useRef(0);
  const anchor = search.date ?? dayKey(new Date());
  const period = search.period ?? "week";
  const weeks = useMemo(() => progressWeeks(anchor, period), [anchor, period]);
  const dates = weeks.flat().filter((date): date is string => date !== null);
  const chosen = clients.find((client) => client.id === search.client);
  const dayClient = clients.find((client) => client.id === search.dayClient);
  const dayEntry = dayClient ? entries[dayClient.id] : undefined;
  const dayData = useMemo(
    () =>
      dayEntry?.snapshot && search.day
        ? (progressDays(dayEntry.snapshot).get(search.day) ?? {
            date: search.day,
            workouts: [],
            cardio: [],
          })
        : undefined,
    [dayEntry?.snapshot, search.day],
  );
  const selectedIndex = search.day ? dates.indexOf(search.day) : -1;
  const change = (next: ClientsSearch, replace = true) => void navigate({ search: next, replace });
  const clearDay = () => change({ ...search, day: undefined, dayClient: undefined });

  useEffect(() => {
    void hydrate().catch(() => setHydrateError(true));
  }, [hydrate]);
  useEffect(() => {
    if (!hydrated || !enabled || viewing) return;
    retainClients(clients);
    warmGoogleAuth();
    if (!refreshing) {
      const missing = clients.filter(
        (client) => !useCoachProgressStore.getState().entries[client.id],
      );
      if (missing.length) void refresh(missing);
    }
  }, [clients, hydrated, enabled, viewing, refreshing, refresh, retainClients]);
  useEffect(() => {
    const container = content.current;
    if (!container) return;
    if (search.day && dayData) {
      container.querySelector<HTMLButtonElement>(".ts-back")?.focus({ preventScroll: true });
      if (dayClient) restoreDay.current = { clientId: dayClient.id, date: search.day };
      const main = container.closest("main");
      if (main) main.scrollTop = 0;
    } else if (restoreDay.current) {
      const { clientId, date } = restoreDay.current;
      const section = [...container.querySelectorAll<HTMLElement>("[data-client-id]")].find(
        (node) => node.dataset.clientId === clientId,
      );
      const button = [...(section?.querySelectorAll<HTMLButtonElement>("[data-date]") ?? [])].find(
        (node) => node.dataset.date === date,
      );
      button?.focus({ preventScroll: true });
      const main = container.closest("main");
      if (main) main.scrollTop = rosterScroll.current;
      restoreDay.current = null;
    }
  }, [search.day, dayData, dayClient]);

  if (hydrateError)
    return (
      <div className="px-4 pt-14">
        <h1 className="t-title">Clients</h1>
        <p className="mt-4 t-body">Couldn't load your client list</p>
        <button
          type="button"
          className="mt-2 min-h-11 t-action"
          onClick={() =>
            void hydrate()
              .then(() => setHydrateError(false))
              .catch(() => {})
          }
        >
          Try again
        </button>
      </div>
    );
  if (!hydrated)
    return (
      <div className="px-4 pt-14">
        <h1 className="t-title">Clients</h1>
        <p className="mt-4 t-label text-ink-2" role="status">
          Loading clients…
        </p>
      </div>
    );
  if (!enabled)
    return (
      <div className="px-4 pt-14">
        <h1 className="t-title">Clients</h1>
        <p className="mt-4 t-body text-ink-2">
          Turn on coach mode in Settings to view your clients
        </p>
        <Link to="/settings" className="mt-2 inline-flex min-h-11 items-center t-action">
          Open Settings
        </Link>
      </div>
    );
  if (viewing)
    return (
      <div className="px-4 pt-14">
        <h1 className="t-title">Clients</h1>
        <p className="mt-4 t-body text-ink-2">
          Tap Done in {viewing.client.name}'s banner to return to your client roster
        </p>
      </div>
    );

  const openDay = (clientId: string, date: string) => {
    rosterScroll.current = content.current?.closest("main")?.scrollTop ?? 0;
    restoreDay.current = { clientId, date };
    change({ ...search, day: date, dayClient: clientId });
  };
  const rangeLabel =
    period === "month"
      ? format(parseDayKey(anchor), "MMMM yyyy")
      : `${format(parseDayKey(dates[0]), "d MMM")}–${format(parseDayKey(dates.at(-1)!), "d MMM yyyy")}`;

  return (
    <div ref={content} className="px-4 pt-14 pb-5">
      {search.day && dayClient ? (
        <>
          {dayData && dayEntry?.snapshot ? (
            <CoachProgressDay
              day={dayData}
              unit={dayEntry.snapshot.unit}
              clientName={dayClient.name}
              onBack={clearDay}
              status={
                <SnapshotStatus
                  entry={dayEntry}
                  refreshing={refreshing}
                  onRefresh={() => void refresh([dayClient], true)}
                />
              }
              onPrevious={
                selectedIndex > 0
                  ? () => change({ ...search, day: dates[selectedIndex - 1] })
                  : undefined
              }
              onNext={
                selectedIndex >= 0 && selectedIndex < dates.length - 1
                  ? () => change({ ...search, day: dates[selectedIndex + 1] })
                  : undefined
              }
            />
          ) : (
            <>
              <button type="button" className="min-h-11 t-action" onClick={clearDay}>
                Back to calendar
              </button>
              <p className="mt-3 t-body">
                {dayEntry?.loading ? "Reading client's sheet…" : "Calendar unavailable"}
              </p>
              <SnapshotStatus
                entry={dayEntry}
                refreshing={refreshing}
                onRefresh={() => void refresh([dayClient], true)}
              />
            </>
          )}
        </>
      ) : (
        <>
          {chosen && (
            <button
              type="button"
              className="-mt-5 mb-2 flex min-h-11 items-center gap-1 text-[13px]"
              onClick={() => change({ ...search, client: undefined })}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              All clients
            </button>
          )}
          <header className="relative pr-12">
            <h1 className="text-[24px] font-semibold leading-tight">{chosen?.name ?? "Clients"}</h1>
            <p className="mt-1 text-[11px] text-ink-2">Daily numbers and logged training</p>
            <Link
              to="/settings"
              aria-label="Settings"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-ink-3"
            >
              <Settings size={22} aria-hidden="true" />
            </Link>
          </header>
          <div
            className="mt-3 grid grid-cols-3 rounded-md bg-surface p-[3px]"
            role="group"
            aria-label="Date range"
          >
            {(
              [
                ["week", "Week"],
                ["fortnight", "2 weeks"],
                ["month", "Month"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`min-h-11 rounded-sm text-[12px] ${key === period ? "bg-wash" : ""}`}
                aria-pressed={period === key}
                onClick={() => change({ ...search, period: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="my-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center"
              aria-label="Previous period"
              onClick={() => change({ ...search, date: shiftProgressAnchor(anchor, period, -1) })}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-center text-[11px]" aria-live="polite">
              {rangeLabel}
            </span>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center"
              aria-label="Next period"
              onClick={() => change({ ...search, date: shiftProgressAnchor(anchor, period, 1) })}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-ink-2">
            <span>W Weight</span>
            <span className="inline-flex items-center gap-0.5">
              <Flame size={10} aria-hidden="true" /> Calories
            </span>
            <span>P/C/F Macros (g)</span>
            <span className="inline-flex items-center gap-0.5">
              <Footprints size={10} aria-hidden="true" /> Steps
            </span>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {anchor !== dayKey(new Date()) && (
              <button
                type="button"
                className="min-h-11 text-[12px] t-action"
                onClick={() => change({ ...search, date: undefined })}
              >
                {period === "month"
                  ? "This month"
                  : period === "fortnight"
                    ? "Current 2 weeks"
                    : "This week"}
              </button>
            )}
            <button
              type="button"
              className="ml-auto min-h-11 text-[12px] t-action disabled:text-ink-3"
              disabled={refreshing || clients.length === 0}
              onClick={() => void refresh(chosen ? [chosen] : clients, true)}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {clients.length === 0 && (
            <div className="group-list p-4">
              <p className="t-body">No clients yet</p>
              <Link to="/settings" className="mt-2 inline-flex min-h-11 items-center t-action">
                Add or invite a client
              </Link>
            </div>
          )}
          {(chosen ? [chosen] : clients).map((client) => {
            const entry = entries[client.id];
            return (
              <section
                key={client.id}
                data-client-id={client.id}
                className="mb-4"
                aria-label={`${client.name}'s calendar`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-center text-left text-[14px] font-medium"
                    onClick={() => change({ ...search, client: client.id })}
                  >
                    <span className="break-words">{client.name}</span>
                  </button>
                  <span className="shrink-0 text-[9px] text-ink-2">
                    {entry?.loading
                      ? "Refreshing…"
                      : entry?.fetchedAt !== undefined
                        ? `Fetched ${freshness(entry.fetchedAt)}`
                        : "Not fetched"}
                    {entry?.snapshot && (
                      <span className="block text-right">Weight ({entry.snapshot.unit})</span>
                    )}
                  </span>
                </div>
                <ClientCalendar
                  clientId={client.id}
                  name={client.name}
                  entry={entry}
                  weeks={weeks}
                  onDay={openDay}
                />
              </section>
            );
          })}
          {clients.length > 0 && (
            <p className="mt-3 text-[10px] text-ink-2">
              – = not recorded · Tap a day for full details
            </p>
          )}
          {chosen && (
            <button
              type="button"
              disabled={loading}
              className="mt-3 min-h-11 w-full rounded-md bg-surface text-[13px]"
              onClick={() =>
                void enterClientView(chosen.id).then((ok) => {
                  if (ok) void navigate({ to: "/plan" });
                })
              }
            >
              {loading ? "Opening client…" : "Open client's Trakt and plan"}
            </button>
          )}
          {chosen && lastError && (
            <p className="mt-2 text-[12px] text-signal" role="status">
              {progressErrorMessage(lastError === "unreachable" ? "network" : lastError)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
