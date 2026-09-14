import { describe, expect, it } from "vitest";
import {
  decodeInvite,
  encodeInvite,
  INVITE_VERSION,
  inviteUrl,
  type ConnectPayload,
  type JoinPayload,
} from "../invite";

const CONNECT: ConnectPayload = {
  v: INVITE_VERSION,
  kind: "connect",
  url: "https://script.google.com/macros/s/AKfycbTEST/exec",
  secret: "a-long-random-secret",
  label: "Bob's sheet",
};

const JOIN: JoinPayload = {
  v: INVITE_VERSION,
  kind: "join",
  coachName: "Marcus",
  coachEmail: "marcus@example.com",
  clientName: "Bob",
};

describe("round trip", () => {
  it("carries a connect payload", () => {
    expect(decodeInvite(encodeInvite(CONNECT))).toEqual(CONNECT);
  });

  it("carries a join payload", () => {
    expect(decodeInvite(encodeInvite(JOIN))).toEqual(JOIN);
  });

  it("accepts a fragment with or without its leading hash", () => {
    const fragment = encodeInvite(JOIN);
    expect(decodeInvite(`#${fragment}`)).toEqual(JOIN);
  });

  it("survives names with spaces, apostrophes and non-ASCII", () => {
    const payload: JoinPayload = { ...JOIN, coachName: "Renée O'Brien", clientName: "Søren" };
    expect(decodeInvite(encodeInvite(payload))).toEqual(payload);
  });

  it("produces a fragment safe to paste through a messaging app", () => {
    // base64url: no +, / or = to be mangled by link detectors.
    expect(encodeInvite(CONNECT)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("stays short enough to text", () => {
    expect(inviteUrl("https://trakt.app", CONNECT).length).toBeLessThan(400);
  });
});

describe("refusing anything else", () => {
  it.each([
    ["nothing", undefined],
    ["an empty fragment", ""],
    ["a bare hash", "#"],
    ["a fragment from something else", "section-3"],
    ["truncated base64", encodeInvite(CONNECT).slice(0, 12)],
    ["valid base64 that is not JSON", btoa("hello there").replace(/=+$/, "")],
  ])("refuses %s", (_label, fragment) => {
    expect(decodeInvite(fragment)).toBeUndefined();
  });

  it("refuses a payload from a future version rather than half-applying it", () => {
    const future = encodeInvite({ ...CONNECT, v: INVITE_VERSION + 1 });
    expect(decodeInvite(future)).toBeUndefined();
  });

  it("refuses an unknown kind", () => {
    const odd = encodeInvite({ v: INVITE_VERSION, kind: "something" } as never);
    expect(decodeInvite(odd)).toBeUndefined();
  });

  it.each([
    ["no url", { ...CONNECT, url: "" }],
    ["no secret", { ...CONNECT, secret: "" }],
  ])("refuses a connect payload with %s", (_label, payload) => {
    expect(decodeInvite(encodeInvite(payload as ConnectPayload))).toBeUndefined();
  });

  it("refuses a join payload with no coach name", () => {
    expect(decodeInvite(encodeInvite({ ...JOIN, coachName: "" }))).toBeUndefined();
  });

  it("drops fields of the wrong type rather than passing them through", () => {
    const odd = encodeInvite({ ...JOIN, clientName: 42 } as never);
    expect(decodeInvite(odd)).toEqual({ ...JOIN, clientName: undefined });
  });
});

describe("inviteUrl", () => {
  it("routes a connect payload to /connect and a join to /join", () => {
    expect(inviteUrl("https://trakt.app", CONNECT)).toContain("/connect#");
    expect(inviteUrl("https://trakt.app", JOIN)).toContain("/join#");
  });

  it("puts the payload in the fragment, never the query string", () => {
    // A query string reaches the server and lands in access logs; for a connect
    // link that is the difference between texting a credential and publishing it.
    const url = inviteUrl("https://trakt.app", CONNECT);
    expect(url).not.toContain("?");
    expect(url.split("#")[1]).toBe(encodeInvite(CONNECT));
  });

  it("does not double the slash on an origin that has one", () => {
    expect(inviteUrl("https://trakt.app/", JOIN)).toContain("https://trakt.app/join#");
  });

  it("never puts a secret anywhere but the fragment", () => {
    const url = inviteUrl("https://trakt.app", CONNECT);
    expect(url.split("#")[0]).not.toContain(CONNECT.secret);
  });
});
