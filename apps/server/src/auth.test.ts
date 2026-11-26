import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "./app.js";
import { auth, sessionUpdateAgeSeconds } from "./auth.js";
import { db } from "./db/index.js";
import { setRegistration } from "./db/queries/settings.js";
import { mintResetLink } from "./db/queries/reset-link.js";
import { deviceCodes, verifications } from "./db/schema/auth.js";
import { betterAuthUrl } from "./lib/env.js";
import { DEFAULT_INSTANCE_POLICY } from "./lib/instance-policy.js";
import {
  authUrl,
  baseUrl,
  cookieHeaders,
  password,
  signInAsGuest,
  signUpAndSignIn,
  trustedOrigin,
} from "./test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "./test/instance-policy.js";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * A fresh simulated caller per request, so the per-address `auth-signin`
 * bucket (10 burst, `app.ts`) never throttles a test that deliberately drives
 * the per-account lockout well past ten attempts — the two limiters are meant
 * to compose, not for one to mask the other in its own tests. It keeps the
 * registrations below out of the `oauth-register` bucket (5 burst) every
 * anonymous test caller would otherwise share, for the same reason.
 */
const distinctCaller = () => ({
  requestIP: () => ({ address: crypto.randomUUID(), family: "IPv4" as const }),
});

function signInAttempt(email: string, attemptedPassword: string) {
  return app.request(
    `${baseUrl}${authUrl}/sign-in/email`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: attemptedPassword }),
    },
    distinctCaller()
  );
}

function register(metadata: Record<string, unknown>) {
  return app.request(
    `${baseUrl}${authUrl}/oauth2/register`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(metadata),
    },
    distinctCaller()
  );
}

/** What a CLI MCP client registers: public, a loopback callback, no `application_type`. */
const cliClient = {
  client_name: "CLI MCP client",
  redirect_uris: ["http://127.0.0.1:8989/oauth/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: "read write",
};

afterEach(() => {
  mock.restore();
  restoreInstancePolicy();
});

describe("POST /auth/sign-in/email lockout", () => {
  it("locks on the sixth wrong password and doubles the lock on the next", async () => {
    const actor = await signUpAndSignIn("Lockout Doubling");
    const now = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    for (let i = 0; i < 6; i += 1) {
      const res = await signInAttempt(actor.email, "wrong-password");
      expect(res.status).toBe(401);
    }

    const firstLock = await signInAttempt(actor.email, "wrong-password");
    expect(firstLock.status).toBe(429);
    expect(firstLock.headers.get("Retry-After")).toBe("60");
    // The lock blocks the correct password too — it is an account lock, not
    // just a filter on bad guesses.
    expect((await signInAttempt(actor.email, password)).status).toBe(429);

    // The first lock has lapsed, but the 15-minute window has not: the next
    // failure is the account's seventh, doubling the lock rather than
    // starting it over.
    now.mockReturnValue(1_700_000_000_000 + 61_000);
    expect((await signInAttempt(actor.email, "wrong-password")).status).toBe(
      401
    );
    const secondLock = await signInAttempt(actor.email, "wrong-password");
    expect(secondLock.status).toBe(429);
    expect(secondLock.headers.get("Retry-After")).toBe("120");
  });

  it("clears on a successful sign-in, freeing five failures again", async () => {
    const actor = await signUpAndSignIn("Lockout Clears");

    for (let i = 0; i < 5; i += 1) {
      expect((await signInAttempt(actor.email, "wrong-password")).status).toBe(
        401
      );
    }

    expect((await signInAttempt(actor.email, password)).status).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      expect((await signInAttempt(actor.email, "wrong-password")).status).toBe(
        401
      );
    }
  });

  it("locks an address with no account behind it exactly like a real one, with the same body", async () => {
    const realActor = await signUpAndSignIn("Lockout Real Account");
    const unknownEmail = `nobody-${crypto.randomUUID()}@example.com`;

    let realResult: Response | undefined;
    let unknownResult: Response | undefined;
    // The sixth attempt is still the failure that trips the lock; the
    // seventh is the one that is actually refused by it.
    for (let i = 0; i < 7; i += 1) {
      realResult = await signInAttempt(realActor.email, "wrong-password");
      unknownResult = await signInAttempt(unknownEmail, "wrong-password");
    }

    expect(realResult!.status).toBe(429);
    expect(unknownResult!.status).toBe(429);
    expect(realResult!.headers.get("Retry-After")).toBe(
      unknownResult!.headers.get("Retry-After")
    );
    expect(await realResult!.json()).toEqual(await unknownResult!.json());
  });

  /**
   * Regression: before this lockout existed, every one of a burst of wrong
   * passwords reached Better Auth's own password check — the per-account
   * lock is what stops a wrong password from *always* costing a hash
   * verification. Once locked, the remaining attempts are refused before the
   * handler ever runs, so only the failures that happened before the lock
   * took effect ever reach it.
   */
  it("50 wrong passwords do not all reach the password check", async () => {
    const actor = await signUpAndSignIn("Lockout Regression");

    const statuses: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      statuses.push(
        (await signInAttempt(actor.email, "wrong-password")).status
      );
    }

    const reachedPasswordCheck = statuses.filter((s) => s === 401).length;
    const refusedByLockout = statuses.filter((s) => s === 429).length;
    expect(reachedPasswordCheck).toBe(6);
    expect(refusedByLockout).toBe(44);
  });

  it("locks past the instance's own free allowance", async () => {
    const actor = await signUpAndSignIn("Lockout Policy");
    stubInstancePolicy({ access: { lockoutFreeFailures: 1 } });

    expect((await signInAttempt(actor.email, "wrong-password")).status).toBe(
      401
    );
    // The second failure trips the lock; the third attempt is refused by it.
    expect((await signInAttempt(actor.email, "wrong-password")).status).toBe(
      401
    );
    const refused = await signInAttempt(actor.email, password);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
  });
});

describe("the instance's password rule", () => {
  const signUp = (body: Record<string, string>) =>
    app.request(
      `${baseUrl}${authUrl}/sign-up/email`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
      distinctCaller()
    );

  const freshEmail = () => `password-rule-${crypto.randomUUID()}@example.com`;

  it("refuses a sign-up outside the rule in force with Better Auth's own errors", async () => {
    await setRegistration("open", null);
    stubInstancePolicy({ access: { passwordMin: 12, passwordMax: 16 } });

    const short = await signUp({
      email: freshEmail(),
      name: "Too Short",
      password: "elevenchars",
    });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({
      code: "PASSWORD_TOO_SHORT",
      message: "Password too short",
    });

    const long = await signUp({
      email: freshEmail(),
      name: "Too Long",
      password: "seventeen-letters",
    });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({
      code: "PASSWORD_TOO_LONG",
      message: "Password too long",
    });

    const fits = await signUp({
      email: freshEmail(),
      name: "Just Right",
      password: "twelve-chars",
    });
    expect(fits.status).toBe(200);
  });

  it("holds a changed password to the rule in force", async () => {
    const actor = await signUpAndSignIn("Password Change Rule");
    stubInstancePolicy({ access: { passwordMin: 20 } });

    const res = await app.request(`${baseUrl}${authUrl}/change-password`, {
      method: "POST",
      headers: cookieHeaders(actor.cookie),
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "nineteen-characters",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
  });

  it("holds a reset password to the rule in force, leaving the link usable", async () => {
    const actor = await signUpAndSignIn("Password Reset Rule");
    const token = new URL(await mintResetLink(actor.userId)).searchParams.get(
      "token"
    );
    stubInstancePolicy({ access: { passwordMin: 20 } });

    const reset = (newPassword: string) =>
      app.request(`${baseUrl}${authUrl}/reset-password`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ token, newPassword }),
      });

    const refused = await reset("nineteen-characters");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });

    expect((await reset("twenty-characters-ok")).status).toBe(200);
  });
});

describe("the instance's gates on Better Auth's endpoints", () => {
  it("refuses self-deletion while the instance turns it off, and keeps the account", async () => {
    const actor = await signUpAndSignIn("Self Deletion Off");
    stubInstancePolicy({ access: { selfDeletion: false } });

    const res = await app.request(`${baseUrl}${authUrl}/delete-user`, {
      method: "POST",
      headers: cookieHeaders(actor.cookie),
      body: JSON.stringify({ password }),
    });
    expect(res.status).toBe(403);

    const session = await app.request(`${baseUrl}${authUrl}/get-session`, {
      headers: cookieHeaders(actor.cookie),
    });
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(
      actor.userId
    );
  });

  it("refuses the share page's anonymous sign-in while guest access is off", async () => {
    stubInstancePolicy({ access: { guestAccess: false } });

    const res = await app.request(
      `${baseUrl}${authUrl}/sign-in/anonymous`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({}) },
      distinctCaller()
    );
    expect(res.status).toBe(403);
  });
});

describe("the instance policy Better Auth reads", () => {
  it("takes the session lifetime once, at construction", async () => {
    const context = await auth.$context;
    expect(context.sessionConfig.expiresIn).toBe(
      DEFAULT_INSTANCE_POLICY.access.sessionLifetimeDays * 24 * 60 * 60
    );
  });

  it("extends a session after a quarter of a one-day lifetime, and after one day at the default", async () => {
    expect(sessionUpdateAgeSeconds(1)).toBe(6 * 60 * 60);
    expect(
      sessionUpdateAgeSeconds(
        DEFAULT_INSTANCE_POLICY.access.sessionLifetimeDays
      )
    ).toBe(24 * 60 * 60);
  });

  it("hands Better Auth the update age derived from the lifetime it took", async () => {
    const context = await auth.$context;
    expect(context.sessionConfig.updateAge).toBe(
      sessionUpdateAgeSeconds(
        DEFAULT_INSTANCE_POLICY.access.sessionLifetimeDays
      )
    );
    expect(context.sessionConfig.updateAge).toBeLessThan(
      context.sessionConfig.expiresIn
    );
  });

  it("reads the link lifetimes through the options it holds, on every use", async () => {
    const { options } = await auth.$context;
    stubInstancePolicy({ access: { linkLifetimeMinutes: 15 } });

    // What Better Auth reads per request is its own copy of the options: a
    // getter only helps if construction kept it rather than copying a value.
    expect(options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(900);
    expect(options.emailVerification?.expiresIn).toBe(900);
  });

  it("gives an admin-issued reset link the instance's link lifetime", async () => {
    const actor = await signUpAndSignIn("Reset Link Lifetime");
    stubInstancePolicy({ access: { linkLifetimeMinutes: 15 } });
    spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const token = new URL(await mintResetLink(actor.userId)).searchParams.get(
      "token"
    );
    const [row] = await db
      .select({ expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.identifier, `reset-password:${token}`));
    expect(row?.expiresAt).toEqual(new Date(1_700_000_000_000 + 15 * 60_000));
  });
});

describe("POST /auth/oauth2/register", () => {
  it("registers a public client with only loopback redirects as native", async () => {
    const res = await register({
      ...cliClient,
      redirect_uris: [
        "http://127.0.0.1:8989/oauth/callback",
        "http://localhost:8989/oauth/callback",
        "http://[::1]:8989/oauth/callback",
      ],
    });

    expect(res.status).toBe(201);
    expect((await res.json()).application_type).toBe("native");
  });

  it("refuses a non-loopback http redirect", async () => {
    const res = await register({
      ...cliClient,
      redirect_uris: ["http://cli.example.com/oauth/callback"],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
  });

  it("refuses a loopback redirect for a client that says it is web", async () => {
    const res = await register({ ...cliClient, application_type: "web" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
  });

  // A native client may use the HTTPS redirect too, so this is refused only
  // because the registration keeps the web rules, which bar the loopback one.
  it("refuses a public client mixing loopback and non-loopback redirects", async () => {
    const res = await register({
      ...cliClient,
      redirect_uris: [
        "http://127.0.0.1:8989/oauth/callback",
        "https://app.example.com/oauth/callback",
      ],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
  });

  it("refuses loopback redirects for a client that names no auth method", async () => {
    const res = await register({
      ...cliClient,
      token_endpoint_auth_method: undefined,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
  });
});

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

/** `dit login`'s first request, from an address of its own unless one is given. */
function requestDeviceCode(
  clientId = "dit",
  env: ReturnType<typeof distinctCaller> = distinctCaller()
) {
  return app.request(
    `${baseUrl}${authUrl}/device/code`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ client_id: clientId }),
    },
    env
  );
}

async function issueDeviceCode(): Promise<DeviceCode> {
  const res = await requestDeviceCode();
  expect(res.status).toBe(200);
  return res.json();
}

/** One poll of `/device/token`, naming the machine the way `dit login` does. */
function pollDeviceToken(
  deviceCode: string,
  headers: Record<string, string> = {},
  env: ReturnType<typeof distinctCaller> = distinctCaller()
) {
  return app.request(
    `${baseUrl}${authUrl}/device/token`,
    {
      method: "POST",
      headers: { ...jsonHeaders, ...headers },
      body: JSON.stringify({
        grant_type: DEVICE_GRANT,
        device_code: deviceCode,
        client_id: "dit",
      }),
    },
    env
  );
}

/** What the web client's `/device` page does with a code a person typed in. */
function lookUpDeviceCode(cookie: string, userCode: string) {
  return app.request(
    `${baseUrl}${authUrl}/device?user_code=${userCode}`,
    { headers: cookieHeaders(cookie) },
    distinctCaller()
  );
}

function decideDeviceCode(
  decision: "approve" | "deny",
  cookie: string,
  userCode: string
) {
  return app.request(
    `${baseUrl}${authUrl}/device/${decision}`,
    {
      method: "POST",
      headers: { ...cookieHeaders(cookie), Origin: trustedOrigin },
      body: JSON.stringify({ userCode }),
    },
    distinctCaller()
  );
}

/** Looks the code up (which claims it for the caller) and approves it. */
async function approveDeviceCode(cookie: string, userCode: string) {
  expect((await lookUpDeviceCode(cookie, userCode)).status).toBe(200);
  const res = await decideDeviceCode("approve", cookie, userCode);
  expect(res.status).toBe(200);
}

describe("the device grant", () => {
  it("issues a code for the dit client with the web client's verification page", async () => {
    const code = await issueDeviceCode();

    const verification = new URL("/device", betterAuthUrl).href;
    expect(code.verification_uri).toBe(verification);
    expect(
      new URL(code.verification_uri_complete).searchParams.get("user_code")
    ).toBe(code.user_code);
    expect(code.verification_uri_complete.startsWith(verification)).toBe(true);
    expect(code.user_code).toHaveLength(8);
    expect(code.expires_in).toBe(30 * 60);
    expect(code.interval).toBe(5);
  });

  it("refuses a client id other than dit", async () => {
    const res = await requestDeviceCode("some-other-cli");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_client");
  });

  it("hands an approved device an ordinary session labelled by the poll's X-Device-Name", async () => {
    const actor = await signUpAndSignIn("Device Approver");
    const code = await issueDeviceCode();
    await approveDeviceCode(actor.cookie, code.user_code);

    const poll = await pollDeviceToken(code.device_code, {
      "X-Device-Name": "Studio iMac",
    });
    expect(poll.status).toBe(200);
    const { access_token: token, token_type: type } = await poll.json();
    expect(type).toBe("Bearer");

    const session = await app.request(`${baseUrl}${authUrl}/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body.user.id).toBe(actor.userId);
    expect(body.session.deviceName).toBe("Studio iMac");
  });

  it("ends a device's session on a sign-out carrying only its Bearer, as `dit logout` sends it", async () => {
    const actor = await signUpAndSignIn("Device Sign Out");
    const code = await issueDeviceCode();
    await approveDeviceCode(actor.cookie, code.user_code);
    const { access_token: token } = await (
      await pollDeviceToken(code.device_code)
    ).json();
    const bearer = { Authorization: `Bearer ${token}` };

    const signOut = await app.request(`${baseUrl}${authUrl}/sign-out`, {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(signOut.status).toBe(200);

    const session = await app.request(`${baseUrl}${authUrl}/get-session`, {
      headers: bearer,
    });
    expect(await session.json()).toBeNull();
  });

  it("rate-limits the lookup that claims a code once the bucket's burst is spent", async () => {
    const actor = await signUpAndSignIn("Device Lookup Limit");
    const { burst } = DEFAULT_INSTANCE_POLICY.rateLimits["device-signin"];
    const caller = distinctCaller();
    const lookUp = () =>
      app.request(
        `${baseUrl}${authUrl}/device?user_code=ZZZZZZZZ`,
        { headers: cookieHeaders(actor.cookie) },
        caller
      );

    const statuses: number[] = [];
    for (let i = 0; i <= burst; i++) statuses.push((await lookUp()).status);

    expect(statuses.slice(0, burst)).not.toContain(429);
    expect(statuses[burst]).toBe(429);
  });

  it("redeems a code once", async () => {
    const actor = await signUpAndSignIn("Device Single Use");
    const code = await issueDeviceCode();
    await approveDeviceCode(actor.cookie, code.user_code);
    expect((await pollDeviceToken(code.device_code)).status).toBe(200);

    const again = await pollDeviceToken(code.device_code);

    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
  });

  it("answers authorization_pending, then slow_down to a poll inside the interval", async () => {
    const code = await issueDeviceCode();

    const first = await pollDeviceToken(code.device_code);
    expect(first.status).toBe(400);
    expect((await first.json()).error).toBe("authorization_pending");

    const second = await pollDeviceToken(code.device_code);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe("slow_down");
  });

  it("answers access_denied once the person denies it, and forgets the code", async () => {
    const actor = await signUpAndSignIn("Device Denier");
    const code = await issueDeviceCode();
    expect((await lookUpDeviceCode(actor.cookie, code.user_code)).status).toBe(
      200
    );
    expect(
      (await decideDeviceCode("deny", actor.cookie, code.user_code)).status
    ).toBe(200);

    const poll = await pollDeviceToken(code.device_code);

    expect(poll.status).toBe(400);
    expect((await poll.json()).error).toBe("access_denied");
    const rows = await db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCode, code.device_code));
    expect(rows).toHaveLength(0);
  });

  it("answers expired_token for a code past its lifetime", async () => {
    const code = await issueDeviceCode();
    await db
      .update(deviceCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(deviceCodes.deviceCode, code.device_code));

    const poll = await pollDeviceToken(code.device_code);

    expect(poll.status).toBe(400);
    expect((await poll.json()).error).toBe("expired_token");
  });

  it("will not let a second account approve a code the first one claimed", async () => {
    const first = await signUpAndSignIn("Device Claimant");
    const second = await signUpAndSignIn("Device Interloper");
    const code = await issueDeviceCode();
    expect((await lookUpDeviceCode(first.cookie, code.user_code)).status).toBe(
      200
    );

    const res = await decideDeviceCode(
      "approve",
      second.cookie,
      code.user_code
    );

    expect(res.status).toBe(403);
    const poll = await pollDeviceToken(code.device_code);
    expect((await poll.json()).error).toBe("authorization_pending");
  });

  it("refuses a share-page guest looking up, approving or denying a code", async () => {
    const guest = await signInAsGuest();
    const code = await issueDeviceCode();

    expect((await lookUpDeviceCode(guest, code.user_code)).status).toBe(403);
    expect(
      (await decideDeviceCode("approve", guest, code.user_code)).status
    ).toBe(403);
    expect((await decideDeviceCode("deny", guest, code.user_code)).status).toBe(
      403
    );

    const poll = await pollDeviceToken(code.device_code);
    expect((await poll.json()).error).toBe("authorization_pending");
  });

  it("refuses a guest presenting its session as a Bearer token", async () => {
    const guest = await signInAsGuest();
    const token = decodeURIComponent(guest.slice(guest.indexOf("=") + 1));
    const code = await issueDeviceCode();

    const res = await app.request(
      `${baseUrl}${authUrl}/device?user_code=${code.user_code}`,
      { headers: { Authorization: `Bearer ${token}` } },
      distinctCaller()
    );
    expect(res.status).toBe(403);
  });

  it("answers an unauthenticated approval with 401", async () => {
    const code = await issueDeviceCode();

    const res = await app.request(
      `${baseUrl}${authUrl}/device/approve`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ userCode: code.user_code }),
      },
      distinctCaller()
    );

    expect(res.status).toBe(401);
  });

  it("meters code requests per address but never the token poll", async () => {
    const address = crypto.randomUUID();
    const caller = {
      requestIP: () => ({ address, family: "IPv4" as const }),
    };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await requestDeviceCode("dit", caller)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);

    const code = await issueDeviceCode();
    const polls = new Set<number>();
    for (let i = 0; i < 30; i += 1) {
      polls.add((await pollDeviceToken(code.device_code, {}, caller)).status);
    }
    expect([...polls]).toEqual([400]);
  });

  it("is the only plugin serving /device paths, MCP's OAuth provider included", () => {
    const plugins = (auth.options.plugins ?? []) as {
      id: string;
      endpoints?: Record<string, { path?: string } | undefined>;
    }[];
    const servers = plugins
      .filter((plugin) =>
        Object.values(plugin.endpoints ?? {}).some((endpoint) =>
          endpoint?.path?.startsWith("/device")
        )
      )
      .map((plugin) => plugin.id);

    expect(servers).toEqual(["device-authorization"]);
  });
});
