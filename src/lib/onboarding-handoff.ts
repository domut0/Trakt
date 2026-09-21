/**
 * Where the onboarding card was standing when it left /join, and whether the
 * tutorial is waiting on it to arrive.
 *
 * The checklist is born on the invite screen, under the name the client has
 * just typed, and then it moves to Today and lives there. Two copies of one
 * card appearing in two places is the version that has to be explained; a card
 * that travels does not.
 *
 * ## Read, not taken
 *
 * This used to hand the placement over and clear itself on the first read,
 * which lost the animation entirely. The card's effect is set up and torn down
 * again immediately after it mounts - the page hydrates, the tree is
 * regenerated, and the effect runs a second time - and by then the handoff had
 * been consumed and the frame it had queued cancelled. The card sat frozen at
 * the position it was supposed to be flying FROM, with its transition still
 * switched off.
 *
 * So nothing here is cleared by being read. The placement is cleared when the
 * flight is actually released, and the start when the tutorial actually starts,
 * which means any number of torn-down attempts in between simply replay.
 *
 * Both are stamped and both go stale. This is module state, not storage, and a
 * handoff that outlived its moment would mean a cold start replaying an
 * animation about a journey that happened yesterday.
 */

interface Placement {
  top: number;
  left: number;
  width: number;
}

interface Staged extends Placement {
  at: number;
}

/** A flight not released within this is one whose moment has passed. */
const PLACEMENT_TTL_MS = 5_000;
/** The tutorial start survives longer: it waits out the flight and a beat. */
const START_TTL_MS = 20_000;

let staged: Staged | undefined;
let startAt: number | undefined;

/** Called on /join, just before navigating to Today. */
export function stageHandoff(rect: Placement): void {
  staged = { top: rect.top, left: rect.left, width: rect.width, at: Date.now() };
}

/** The staged placement, if there is a fresh one. Does NOT clear it. */
export function pendingHandoff(): Placement | undefined {
  if (!staged) return undefined;
  if (Date.now() - staged.at > PLACEMENT_TTL_MS) {
    staged = undefined;
    return undefined;
  }
  return { top: staged.top, left: staged.left, width: staged.width };
}

/** Called once the flight is genuinely in the air. */
export function clearHandoff(): void {
  staged = undefined;
}

/**
 * The tutorial begins when the card lands, not when /join leaves.
 *
 * It used to start before the navigation, so Today painted already in tutorial
 * mode: the spotlight's dim went up over the card while it was still in the
 * air, and its auto-scroll moved the page out from under it. The journey the
 * whole animation exists to show happened behind a black sheet, which read as
 * the app skipping straight to Settings.
 */
export function stageTutorialStart(): void {
  startAt = Date.now();
}

/** Whether a start is still owed. Does NOT clear it. */
export function startPending(): boolean {
  if (startAt === undefined) return false;
  if (Date.now() - startAt > START_TTL_MS) {
    startAt = undefined;
    return false;
  }
  return true;
}

/** Claims the start. True for exactly one caller, so two timers cannot race. */
export function consumeTutorialStart(): boolean {
  if (!startPending()) return false;
  startAt = undefined;
  return true;
}
