/**
 * The coach who invited this person, remembered from their `/join` link until
 * the sheet has been shared with them.
 *
 * localStorage rather than Dexie: it is a one-off onboarding hint, not the
 * person's data, and must not ride along in a backup. Every access is wrapped,
 * because private browsing can make localStorage throw, and losing the hint
 * only means typing the coach's address by hand.
 */

const KEY = "trakt.pendingCoach";

export interface PendingCoach {
  name: string;
  email?: string;
  /** Set once the sheet has been shared with them. */
  sharedAt?: number;
}

export function loadPendingCoach(): PendingCoach | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PendingCoach> | null;
    if (!parsed || typeof parsed.name !== "string") return undefined;
    return {
      name: parsed.name,
      ...(typeof parsed.email === "string" ? { email: parsed.email } : {}),
      ...(typeof parsed.sharedAt === "number" ? { sharedAt: parsed.sharedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

export function savePendingCoach(coach: PendingCoach): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(coach));
  } catch {
    // See the module note: the hint is a convenience.
  }
}
