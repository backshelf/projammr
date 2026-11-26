import { describe, expect, it } from "bun:test";
import { isSignedOut, resolveSessionState, sessionUser } from "./session-state";

type SessionData = Parameters<typeof resolveSessionState>[0];

const sessionFor = (isAnonymous: boolean) =>
  ({
    user: { id: "user_1", name: "Reader", isAnonymous },
    session: { id: "session_1", token: "token_1" },
  }) as unknown as NonNullable<SessionData>;

describe("resolveSessionState", () => {
  it("reads a real account off the verified cookie", () => {
    const state = resolveSessionState(sessionFor(false), null);

    expect(state.kind).toBe("member");
    expect(sessionUser(state)?.id).toBe("user_1");
  });

  it("reads an anonymous account off the verified cookie as a guest", () => {
    expect(resolveSessionState(sessionFor(true), null).kind).toBe("guest");
  });

  it("does not call the API when the cookie answers", () => {
    const state = resolveSessionState(sessionFor(false), {
      data: null,
      error: { status: 429 },
    });

    expect(state.kind).toBe("member");
  });

  it("takes the session from the API when there is no cookie", () => {
    const state = resolveSessionState(null, {
      data: sessionFor(false),
      error: null,
    });

    expect(state.kind).toBe("member");
  });

  it("treats a 401 as nobody being signed in", () => {
    const state = resolveSessionState(null, {
      data: null,
      error: { status: 401 },
    });

    expect(state.kind).toBe("signed-out");
    expect(isSignedOut(state)).toBe(true);
  });

  // The bug this guards: a rate-limited session read presented as a signed-out
  // visitor, so every page rendered its signed-out shell and every guarded
  // route bounced — retries that kept the limiter saturated.
  it("treats a 429 as unavailable rather than signed out", () => {
    const state = resolveSessionState(null, {
      data: null,
      error: { status: 429 },
    });

    expect(state).toEqual({ kind: "unavailable", status: 429 });
    expect(isSignedOut(state)).toBe(false);
  });

  it("treats an unanswered read as unavailable", () => {
    expect(resolveSessionState(null, null)).toEqual({ kind: "unavailable" });
  });
});

describe("isSignedOut", () => {
  it("counts a guest, who is only meant to reach a share or invite page", () => {
    expect(isSignedOut(resolveSessionState(sessionFor(true), null))).toBe(true);
  });

  it("does not count a member", () => {
    expect(isSignedOut(resolveSessionState(sessionFor(false), null))).toBe(
      false
    );
  });
});
