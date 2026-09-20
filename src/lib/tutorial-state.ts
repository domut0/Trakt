/**
 * Onboarding and tutorial workout progress.
 *
 * Stored in localStorage rather than Dexie settings: that row is mirrored to
 * the Google Sheet, and a coach has no business seeing which tutorial steps
 * their client skipped.
 *
 * Every access is wrapped in try/catch, because private browsing modes can
 * throw on any localStorage access, and a blocked write should never crash
 * the app.
 */

const KEY = "trakt.tutorial";

export interface TutorialState {
  /** First /join open. Anchors nothing yet, but dates the record. */
  joinedAt: number;
  /** Set when step 9 completes, or when Skip is tapped. */
  doneAt?: number;
  /** Set when the Getting started card is dismissed. */
  cardDismissedAt?: number;
  /** Set when the Tutorial done closing card is dismissed. */
  closingCardDismissedAt?: number;
  /** True once navigator.standalone or display-mode:standalone was ever seen. */
  installedSeen?: boolean;
}

export function loadTutorialState(): TutorialState | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<TutorialState> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.joinedAt !== "number") {
      return undefined;
    }
    return {
      joinedAt: parsed.joinedAt,
      ...(typeof parsed.doneAt === "number" ? { doneAt: parsed.doneAt } : {}),
      ...(typeof parsed.cardDismissedAt === "number"
        ? { cardDismissedAt: parsed.cardDismissedAt }
        : {}),
      ...(typeof parsed.closingCardDismissedAt === "number"
        ? { closingCardDismissedAt: parsed.closingCardDismissedAt }
        : {}),
      ...(typeof parsed.installedSeen === "boolean" ? { installedSeen: parsed.installedSeen } : {}),
    };
  } catch {
    return undefined;
  }
}

export function saveTutorialState(next: TutorialState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // See module note: private browsing can throw on storage access.
  }
}

export function markTutorialDone(): void {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  if (current.doneAt !== undefined) return;
  saveTutorialState({ ...current, doneAt: Date.now() });
}

export function markInstalledSeen(): void {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  if (current.installedSeen) return;
  saveTutorialState({ ...current, installedSeen: true });
}
