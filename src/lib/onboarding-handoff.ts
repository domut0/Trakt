/**
 * Where the onboarding card was standing when it left /join.
 *
 * The checklist is born on the invite screen, under the name the client has
 * just typed, and then it moves to Today and lives there. Two copies of one
 * card appearing in two places is the version that has to be explained; a card
 * that travels does not.
 *
 * A module-level variable rather than state or storage, because it is true for
 * about half a second and is consumed exactly once. Storing it would mean the
 * next cold start replaying an animation about a journey that happened
 * yesterday.
 */

interface Placement {
  top: number;
  left: number;
  width: number;
}

let staged: Placement | undefined;

/** Called on /join, just before navigating to Today. */
export function stageHandoff(rect: Placement): void {
  staged = { top: rect.top, left: rect.left, width: rect.width };
}

/** Called once by the card on Today. Clears itself, so it can only play once. */
export function takeHandoff(): Placement | undefined {
  const placement = staged;
  staged = undefined;
  return placement;
}
