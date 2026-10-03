import { isValid } from "date-fns";
import { dayKey, parseDayKey } from "./daily-log";
import type { ProgressPeriod } from "./coach-progress";
import type { ProgressError } from "./coach-progress-store";

export interface ClientsSearch {
  period?: ProgressPeriod;
  date?: string;
  client?: string;
  day?: string;
  dayClient?: string;
}
const isDay = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  isValid(parseDayKey(value)) &&
  dayKey(parseDayKey(value)) === value;
export function clientsSearch(search: Record<string, unknown>): ClientsSearch {
  return {
    period:
      search.period === "week" || search.period === "fortnight" || search.period === "month"
        ? search.period
        : undefined,
    date: isDay(search.date) ? search.date : undefined,
    client: typeof search.client === "string" ? search.client : undefined,
    day: isDay(search.day) ? search.day : undefined,
    dayClient: typeof search.dayClient === "string" ? search.dayClient : undefined,
  };
}
export function progressErrorMessage(error: ProgressError): string {
  if (error === "needs-consent") return "Connect Google to read this client's sheet";
  if (error === "popup-blocked") return "Google sign-in was blocked. Tap Refresh to try again";
  if (error === "not-configured")
    return "No readable sheet connected. Check this client in Settings";
  if (error === "bad-secret" || error === "unreadable")
    return "Couldn't read this sheet. Check that it is shared with your Google account";
  return "Couldn't refresh this sheet. Check your connection and try Refresh";
}
