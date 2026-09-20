/**
 * Links that carry setup, so a client never types anything.
 *
 * Two shapes, and the difference between them matters:
 *
 *   A CONNECT link carries a sheet's url and secret, which together are a
 *   bearer capability over that sheet. It exists for sheets set up by hand
 *   through the Apps Script flow, where there is genuinely something to hand
 *   over. Treat it like a password.
 *
 *   A JOIN link carries no credential at all. Under the Sheets API flow the
 *   client creates their own spreadsheet in their own Drive, so there is
 *   nothing to transfer -- the link only pre-names them and scripts the
 *   sequence.
 *
 * ## Why the fragment
 *
 * Both are carried in the URL fragment, never the query string. A fragment is
 * not sent to the server and does not appear in access logs, proxy logs or
 * `Referer` headers. For a connect link that is the difference between texting
 * someone a credential and publishing it.
 */

export const INVITE_VERSION = 1;

export interface JoinPayload {
  v: number;
  kind: "join";
  coachName: string;
  /** Who the client's sheet gets shared with. Never a credential. */
  coachEmail?: string;
  clientName?: string;
}

export type InvitePayload = JoinPayload;

// --- base64url ------------------------------------------------------------
//
// Not plain base64: `+` and `/` are both legal in a fragment but survive
// copy-paste through messaging apps badly, and `=` padding is routinely eaten
// by link detectors. base64url avoids all three.

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The fragment for an invite link, without the leading `#`. */
export function encodeInvite(payload: InvitePayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/**
 * The payload a fragment carries, or undefined when it does not carry one.
 *
 * Every failure reads as undefined rather than throwing: a truncated link, a
 * fragment from something else entirely, and a payload from a future version
 * are all things a real user can arrive with, and none of them should render
 * anything but a plain "this link did not work".
 */
export function decodeInvite(fragment: string | undefined): InvitePayload | undefined {
  if (!fragment) return undefined;
  const cleaned = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (cleaned === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cleaned)) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const p = parsed as Record<string, unknown>;
  // A newer version may have added required fields this build cannot satisfy,
  // so refusing is safer than half-applying it.
  if (p.v !== INVITE_VERSION) return undefined;

  if (p.kind === "join") {
    if (typeof p.coachName !== "string" || p.coachName === "") return undefined;
    return {
      v: INVITE_VERSION,
      kind: "join",
      coachName: p.coachName,
      ...(typeof p.coachEmail === "string" ? { coachEmail: p.coachEmail } : {}),
      ...(typeof p.clientName === "string" ? { clientName: p.clientName } : {}),
    };
  }

  return undefined;
}

/** A full link, for the coach to send. */
export function inviteUrl(origin: string, payload: InvitePayload): string {
  return `${origin.replace(/\/$/, "")}/join#${encodeInvite(payload)}`;
}
