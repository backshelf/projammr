import { eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import {
  authUrl,
  baseUrl,
  cookieHeaders,
  extractSessionCookie,
  password,
  setupSuite,
  signUpAndSignIn,
  type Actor,
} from "../test/fixtures.js";

const suite = setupSuite("Me");
const { owner, request } = suite;

/** `/me` is about the caller, so each test that writes gets an actor of its own. */
const asNewUser = async (name: string) => {
  const actor = await signUpAndSignIn(`Me ${name}`);
  return (path: string, init: RequestInit = {}) =>
    app.request(`${baseUrl}${path}`, {
      ...init,
      headers: cookieHeaders(actor.cookie),
    });
};

/**
 * Promotes an actor straight in the row, then signs them in again so the
 * fresh session — Better Auth's own cookie cache holds the one it was
 * issued at sign-up with — carries the promotion. Mirrors how `instance.test.ts`
 * writes the role for a caller the API has no way to promote itself.
 */
const asPromotedUser = async (name: string) => {
  const actor = await signUpAndSignIn(`Me ${name}`);
  await db
    .update(users)
    .set({ instanceRole: "admin" })
    .where(eq(users.id, actor.userId));

  const signInRes = await app.request(`${baseUrl}${authUrl}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: actor.email, password }),
  });
  const promoted: Actor = {
    ...actor,
    cookie: extractSessionCookie(signInRes),
  };

  return (path: string, init: RequestInit = {}) =>
    app.request(`${baseUrl}${path}`, {
      ...init,
      headers: cookieHeaders(promoted.cookie),
    });
};

describe("GET /me", () => {
  it("answers with the signed-in user, whose settings are the settings routes'", async () => {
    const res = await request("owner", "/me");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ id: owner.userId, email: owner.email });
    expect(Object.keys(body).sort()).toEqual([
      "email",
      "id",
      "image",
      "instanceRole",
      "name",
    ]);
  });

  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/me");
    expect(res.status).toBe(401);
  });

  it('carries "user" for a caller who does not administer the instance', async () => {
    const requestAsMe = await asNewUser("PlainRole");

    const res = await requestAsMe("/me");
    expect(res.status).toBe(200);
    expect((await res.json()).instanceRole).toBe("user");
  });

  it('carries "admin" for a caller who administers the instance', async () => {
    const requestAsMe = await asPromotedUser("AdminRole");

    const res = await requestAsMe("/me");
    expect(res.status).toBe(200);
    expect((await res.json()).instanceRole).toBe("admin");
  });
});

// This instance runs with no SMTP_URL configured (the default worktree
// environment), so `PATCH /me/email` is live and Better Auth's own
// mail-confirmed `changeEmail` is not. Both paths cannot be exercised
// against the same running app — the no-mail one 404s once `emailEnabled`
// is on — so the emailEnabled=true half of this behaviour is covered by
// `auth-mail.test.ts` (the callback Better Auth would invoke) instead.
describe("PATCH /me/email", () => {
  it("changes the email immediately once the current password checks out", async () => {
    const requestAsMe = await asNewUser("EmailChanger");
    const newEmail = `changed-${Date.now()}@example.com`;

    const res = await requestAsMe("/me/email", {
      method: "PATCH",
      body: JSON.stringify({ newEmail, currentPassword: password }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe(newEmail);

    const read = await requestAsMe("/me");
    expect((await read.json()).email).toBe(newEmail);
  });

  it("rejects the wrong current password", async () => {
    const requestAsMe = await asNewUser("WrongPassword");

    const res = await requestAsMe("/me/email", {
      method: "PATCH",
      body: JSON.stringify({
        newEmail: `wrong-password-${Date.now()}@example.com`,
        currentPassword: "not-the-password",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects setting the email to the one already in use", async () => {
    const requestAsMe = await asNewUser("SameEmail");

    const res = await requestAsMe("/me/email", {
      method: "PATCH",
      body: JSON.stringify({
        newEmail: (await (await requestAsMe("/me")).json()).email,
        currentPassword: password,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an email already used by another account", async () => {
    const requestAsMe = await asNewUser("Claimer");
    const other = await signUpAndSignIn("Me Claimed");

    const res = await requestAsMe("/me/email", {
      method: "PATCH",
      body: JSON.stringify({
        newEmail: other.email,
        currentPassword: password,
      }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/me/email", {
      method: "PATCH",
      body: JSON.stringify({
        newEmail: `anon-${Date.now()}@example.com`,
        currentPassword: password,
      }),
    });
    expect(res.status).toBe(401);
  });

  // The route checks the account's current password, so without a bucket of its
  // own it is a password oracle for anyone holding a session they should not
  // have. The per-account sign-in lockout only guards `/auth/sign-in/email`.
  // Its own fresh account, because the bucket is keyed per user and a shared
  // one would spend the other tests' tokens.
  it("throttles repeated password guesses", async () => {
    const requestAsMe = await asNewUser("Guesser");
    const guess = (n: number) =>
      requestAsMe("/me/email", {
        method: "PATCH",
        body: JSON.stringify({
          newEmail: `guess-${n}-${Date.now()}@example.com`,
          currentPassword: "not-the-password",
        }),
      });

    for (let n = 0; n < 5; n++) {
      expect((await guess(n)).status).toBe(400);
    }
    expect((await guess(5)).status).toBe(429);
  });
});
