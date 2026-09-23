/**
 * Onboarding progress, and the name the sheet is called after.
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
  /** What this person said to call them, and what their sheet is named after. */
  name?: string;
  /** Set when the tutorial first starts, so a resume knows there is one to resume. */
  startedAt?: number;
  /**
   * The step the tutorial was on, by id.
   *
   * By id rather than by index because the step list differs between a phone
   * that can install and a desktop that cannot, and an index would mean
   * something different on each. Resuming lands at the start of that step's
   * CHAPTER - see `resumePoint`.
   */
  stepId?: string;
  /** Set when the last step completes, or when Skip is tapped. */
  doneAt?: number;
  /** Set when the checklist card is dismissed. */
  cardDismissedAt?: number;
  /** True once navigator.standalone or display-mode:standalone was ever seen. */
  installedSeen?: boolean;
  /**
   * True once the install prompt was shown or the iOS walkthrough was read.
   *
   * On iOS the row cannot tick until the app is next launched from the home
   * screen, so the tutorial would otherwise stop dead on a step the user has
   * already done everything they can about.
   */
  installOffered?: boolean;
}

const NUMBER_KEYS = [
  "startedAt",
  "doneAt",
  "cardDismissedAt",
] as const satisfies readonly (keyof TutorialState)[];

export function loadTutorialState(): TutorialState | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<TutorialState> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.joinedAt !== "number") {
      return undefined;
    }
    const out: TutorialState = { joinedAt: parsed.joinedAt };
    for (const key of NUMBER_KEYS) {
      const value = parsed[key];
      if (typeof value === "number") out[key] = value;
    }
    if (typeof parsed.name === "string") out.name = parsed.name;
    if (typeof parsed.stepId === "string") out.stepId = parsed.stepId;
    if (typeof parsed.installedSeen === "boolean") out.installedSeen = parsed.installedSeen;
    if (typeof parsed.installOffered === "boolean") out.installOffered = parsed.installOffered;
    return out;
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

/** Reads the record, applies `change`, writes it back. */
export function updateTutorialState(change: Partial<TutorialState>): TutorialState {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  const next = { ...current, ...change };
  saveTutorialState(next);
  return next;
}

export function markTutorialDone(): void {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  if (current.doneAt !== undefined) return;
  // The resume pointer goes with it. A finished tutorial has nowhere to resume
  // to, and leaving one behind would make a restart begin half way through.
  saveTutorialState({ ...current, doneAt: Date.now(), stepId: undefined });
}

export function markInstalledSeen(): void {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  if (current.installedSeen) return;
  saveTutorialState({ ...current, installedSeen: true });
}

/** The install prompt was shown, or the iOS walkthrough was read. */
export function markInstallOffered(): void {
  const current = loadTutorialState() ?? { joinedAt: Date.now() };
  if (current.installOffered) return;
  saveTutorialState({ ...current, installOffered: true });
}

/** What this person is called, as they typed it. */
export function loadDisplayName(): string | undefined {
  const name = loadTutorialState()?.name?.trim();
  return name && name.length > 0 ? name : undefined;
}

export function saveDisplayName(name: string): void {
  updateTutorialState({ name: name.trim() });
}

/** True when a tutorial was started and neither finished nor skipped. */
export function tutorialInterrupted(): boolean {
  const state = loadTutorialState();
  return state?.startedAt !== undefined && state.doneAt === undefined;
}
