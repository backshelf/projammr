import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { mcp } from "@better-auth/mcp";
import {
  anonymous,
  bearer,
  deviceAuthorization,
  jwt,
  openAPI,
} from "better-auth/plugins";
import { db } from "./db/index.js";
import type { MemberRole } from "./db/queries/authorization.js";
import { deleteAccount } from "./db/queries/account-deletion.js";
import { reassignGuestComments } from "./db/queries/guests.js";
import { admitSignUp, cachedRegistrationMode } from "./db/queries/settings.js";
import { authSessions } from "./db/schema/auth.js";
import { jwks } from "./db/schema/oauth.js";
import {
  checkLockout,
  clearLockout,
  recordFailure,
} from "./db/queries/signin-attempts.js";
import { tables } from "./db/tables.js";
import {
  betterAuthSecret,
  betterAuthUrl,
  emailEnabled,
  mcpEnabled,
  mcpResource,
  trustedOrigins,
} from "./lib/env.js";
import {
  sendChangeEmailConfirmationMail,
  sendDeleteAccountMail,
  sendResetPasswordMail,
  sendVerificationMail,
} from "./lib/auth-mail.js";
import {
  PASSWORD_LENGTH_CEILING,
  PASSWORD_LENGTH_FLOOR,
} from "@workspace/settings/bounds";
import { MCP_SCOPES } from "@workspace/settings/groups/instance-integrations";
import {
  instancePolicy,
  runningInstancePolicy,
} from "./lib/instance-policy.js";
import { log } from "./lib/log.js";
import { sameOrigin } from "./lib/origin.js";

/**
 * Whether this process serves MCP: the instance allows it
 * (`integrations.mcpEnabled`) and the deployment can carry it (`mcpEnabled` in
 * `env.ts`, which `MCP_DISABLED=1` also turns off). Read once, from the
 * running policy, as this module is first imported: Better Auth takes its
 * plugins at construction and `app.ts` mounts the route once, so a change
 * applies at the next start.
 */
export const mcpServed: boolean =
  mcpEnabled && runningInstancePolicy().integrations.mcpEnabled;

/** Built only when `mcpServed`: `mcp()` throws for an insecure resource. */
const mcpPlugins = () =>
  [
    // The OAuth provider signs access tokens with this plugin's keys and
    // publishes them at `/jwks`. Provider mode wants the session-to-JWT header
    // off.
    jwt({ disableSettingJwtHeader: true }),
    // The OAuth 2.1 authorization server for MCP clients, and the RFC 9728
    // metadata for the resource it protects. Registration is open so a client
    // such as Claude Code can register itself; `app.ts` rate-limits it.
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: mcpResource,
      scopes: [...MCP_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
  ] as const;

if (!mcpEnabled && process.env.MCP_DISABLED !== "1") {
  log("auth").warn(
    "MCP is off: BETTER_AUTH_URL must be HTTPS or a loopback host",
    { mcpResource }
  );
}

/**
 * Whether the account being created is a share-page guest. The anonymous
 * plugin's own sign-in goes through the same user-create hook as a
 * registration, and a guest claims no instance and answers to no registration
 * setting.
 */
const isGuest = (user: Record<string, unknown>): boolean =>
  user.isAnonymous === true;

/** The `email` a `/sign-in/email` request body names, or null for a malformed one. */
const emailFromSignIn = (ctx: { body?: unknown }): string | null => {
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : null;
};

/** The only hosts a native client's plain-`http` redirect may name (RFC 8252 §7.3). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether an `/oauth2/register` body can only be a native app's: a public
 * client naming no `application_type` of its own, whose every redirect lands
 * on the loopback interface.
 */
const isNativeRegistration = (body: unknown): boolean => {
  const client = body as
    | {
        application_type?: unknown;
        token_endpoint_auth_method?: unknown;
        redirect_uris?: unknown;
      }
    | undefined;
  const redirects = client?.redirect_uris;
  return (
    client?.application_type === undefined &&
    client?.token_endpoint_auth_method === "none" &&
    Array.isArray(redirects) &&
    redirects.length > 0 &&
    redirects.every(
      (uri) =>
        typeof uri === "string" &&
        LOOPBACK_HOSTS.has(URL.parse(uri)?.hostname ?? "")
    )
  );
};

/** A session row's own name for its caller, capped so a hostile header cannot bloat the row. */
const MAX_DEVICE_NAME_LENGTH = 64;

/**
 * The `X-Device-Name` header a caller sent at sign-in, if any — how a client
 * whose User-Agent string does not label well (dit's webview)
 * tells the server what to call it. `session.additionalFields`
 * declares `deviceName` `input: false`, which only blocks a signed-in
 * caller's own request body from setting it; this hook is the one path that
 * writes the column at all, and it runs once, at session creation.
 */
const deviceNameFrom = (request: Request | undefined): string | null => {
  const header = request?.headers.get("x-device-name")?.trim();
  return header ? header.slice(0, MAX_DEVICE_NAME_LENGTH) : null;
};

/** How long a mailed reset or verification link lasts, in the seconds Better Auth counts in. */
const linkLifetimeSeconds = (): number =>
  instancePolicy().access.linkLifetimeMinutes * 60;

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * How old a session gets before use extends it, in seconds: a quarter of the
 * lifetime, capped at Better Auth's one-day default. A one-day lifetime would
 * otherwise equal the default and never be extended under an active user.
 */
export const sessionUpdateAgeSeconds = (lifetimeDays: number): number =>
  Math.min(SECONDS_PER_DAY, (lifetimeDays * SECONDS_PER_DAY) / 4);

/**
 * With no mail transport, neither `sendResetPassword` nor
 * `requireEmailVerification` can do anything: the one is left undefined
 * rather than wired to a function that would throw, and the other reads
 * false, so `emailAndPassword.enabled` alone still gives sign-up and sign-in.
 *
 * `requireEmailVerification` and `resetPasswordTokenExpiresIn` are getters,
 * not plain values, and are assigned directly onto this object rather than
 * spread in from elsewhere — `{...obj}` reads an accessor once and copies the
 * value it returned, which would freeze it at server boot. Better Auth
 * re-reads both on every sign-in and reset request, so they track
 * `PATCH /settings/instance/instance` toggling registration and a refreshed instance
 * policy without this config being rebuilt. Verification is asked only of a
 * self-service sign-up: an invite-only instance never requires it.
 *
 * Better Auth copies the password length bounds out at construction instead,
 * so they are pinned to the widest range any instance can set, and the
 * instance's own `passwordMin`/`passwordMax` are checked per request in
 * `hooks.before` below.
 */
const emailAndPasswordOptions: BetterAuthOptions["emailAndPassword"] = {
  enabled: true,
  minPasswordLength: PASSWORD_LENGTH_FLOOR,
  maxPasswordLength: PASSWORD_LENGTH_CEILING,
  sendResetPassword: emailEnabled ? sendResetPasswordMail : undefined,
  get requireEmailVerification() {
    return (
      emailEnabled &&
      instancePolicy().access.requireVerifiedEmail &&
      cachedRegistrationMode() === "open"
    );
  },
  get resetPasswordTokenExpiresIn() {
    return linkLifetimeSeconds();
  },
};

/** `expiresIn` is a getter for the same reason as the two above. */
const emailVerificationOptions: BetterAuthOptions["emailVerification"] = {
  sendVerificationEmail: emailEnabled ? sendVerificationMail : undefined,
  get expiresIn() {
    return linkLifetimeSeconds();
  },
};

/**
 * The paths that set a password, and the body field each carries it in. The
 * instance's length rule is checked on each before Better Auth sees it.
 */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

/** The one client id a device may sign in as: the `dit` CLI. */
const DEVICE_CLIENT_ID = "dit";

/**
 * The paths a signed-in person uses to look up, approve or deny a device code.
 * A share-page guest holds a real session, but a device it approved would
 * receive an ordinary session of the guest's own; these are for accounts.
 */
const DEVICE_REVIEW_PATHS = new Set([
  "/device",
  "/device/approve",
  "/device/deny",
]);

/**
 * Refuses a share-page guest on the paths that review a device code. The
 * session is read through `auth.api`, not from the hook's context: `bearer()`
 * turns an `Authorization` header into a session cookie in a plugin hook,
 * and every before hook is handed the request as it arrived, so a guest's
 * Bearer token is only seen through the API's own hook chain.
 */
async function assertNotGuestReviewingDevice(ctx: {
  path: string;
  headers?: Headers;
}): Promise<void> {
  if (!DEVICE_REVIEW_PATHS.has(ctx.path) || !ctx.headers) return;
  const session = await auth.api.getSession({ headers: ctx.headers });
  if (session && isGuest(session.user)) {
    throw new APIError("FORBIDDEN", {
      message: "Sign in to an account to authorize a device",
    });
  }
}

/**
 * Refuses a new password outside the instance's length rule, with the same
 * error Better Auth answers its own bounds with (`PASSWORD_TOO_SHORT`,
 * `PASSWORD_TOO_LONG`), so a client reads one shape whichever check refused.
 */
function assertPasswordLength(ctx: { path: string; body?: unknown }): void {
  const field = PASSWORD_FIELDS[ctx.path];
  if (!field) return;
  const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
  if (typeof password !== "string") return;

  const { passwordMin, passwordMax } = instancePolicy().access;
  if (password.length < passwordMin) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_TOO_SHORT",
      message: "Password too short",
    });
  }
  if (password.length > passwordMax) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_TOO_LONG",
      message: "Password too long",
    });
  }
}

/**
 * The instance's gates on Better Auth's own endpoints: self-deletion, and the
 * anonymous sign-in a share page mints for a guest. Read per request, so a
 * refreshed policy applies to the next attempt.
 */
function assertAllowedByInstance(path: string): void {
  const { selfDeletion, guestAccess } = instancePolicy().access;
  if (
    !selfDeletion &&
    (path === "/delete-user" || path === "/delete-user/callback")
  ) {
    throw new APIError("FORBIDDEN", {
      message: "Account deletion is turned off on this instance",
    });
  }
  if (!guestAccess && path === "/sign-in/anonymous") {
    throw new APIError("FORBIDDEN", {
      message: "Guest access is turned off on this instance",
    });
  }
}

/**
 * Wired only with mail: `changeEmail` needs somewhere to send the
 * confirmation, and `deleteUser` with no `sendDeleteAccountVerification`
 * deletes the account on the spot, which a "confirmation" is supposed to
 * prevent. Without mail, `PATCH /me/email` (`routes/me.ts`) is the change-email
 * path instead — immediate, behind a current-password check — and account
 * deletion waits for that path to exist too.
 */
const userOptions = {
  additionalFields: {
    // Declared so Better Auth reads the column and carries it on the session
    // user, and `input: false` so no sign-up or account update can send one.
    // The only writes are the bootstrap below and `PATCH /admin/users/:id`.
    //
    // `as const`: assigned through this standalone `const` rather than
    // written inline in the `betterAuth({...})` call, these objects no
    // longer get the call's contextual typing to narrow `"string"`/`false`
    // to Better Auth's `DBFieldType`/optionality on their own, which is what
    // `auth.$Infer` needs to carry `instanceRole`/`disabledAt` on the
    // session user at all, and as the nullable, non-required fields they are.
    instanceRole: {
      type: "string",
      required: false,
      input: false,
    } as const,
    disabledAt: { type: "date", required: false, input: false } as const,
  },
  ...(emailEnabled
    ? {
        changeEmail: {
          enabled: true,
          sendChangeEmailConfirmation: sendChangeEmailConfirmationMail,
        },
      }
    : {}),
  // Always enabled, mail or not: with mail, `sendDeleteAccountVerification`
  // makes `POST /delete-user` two-step (mail a token, delete on its
  // callback); without it, Better Auth deletes on the spot once the body's
  // `password` checks out (or the session is still fresh). `beforeDelete`
  // runs immediately before Better Auth deletes the `users` row itself,
  // whichever path got there, so it is the one place the account's own
  // cleanup belongs.
  deleteUser: {
    enabled: true,
    ...(emailEnabled
      ? { sendDeleteAccountVerification: sendDeleteAccountMail }
      : {}),
    beforeDelete: async (user: { id: string }) => {
      await deleteAccount(user.id);
    },
  },
};

export const auth = betterAuth({
  plugins: [
    openAPI(),
    bearer(),
    anonymous({
      // The plugin deletes the anonymous user right after this runs (unless
      // the new session is itself anonymous), so a guest's comments have to
      // move onto the new account before that delete lands, or the FK
      // cascade takes them with it.
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await reassignGuestComments(anonymousUser.user.id, newUser.user.id);
      },
    }),
    // RFC 8628 for the `dit` CLI. The session the poll mints is an ordinary
    // one (`bearer()` reads it back), labelled by `X-Device-Name` on the poll
    // through `databaseHooks.session.create`. The verification page is the web
    // client's `/device`, resolved against `baseURL`.
    deviceAuthorization({
      validateClient: (clientId) => clientId === DEVICE_CLIENT_ID,
      verificationUri: "/device",
    }),
    ...(mcpServed ? mcpPlugins() : []),
  ],
  // The JWT plugin's session-to-JWT exchange, which nothing calls; an OAuth
  // provider must not hand out tokens outside its own token endpoint.
  // `/request-password-reset` joins it with no mail transport: the endpoint
  // exists either way, but with nothing to send `sendResetPassword` through
  // it would only 400. 404 is what tells a fresh, mail-less instance to point
  // its user at the admin instead.
  disabledPaths: emailEnabled
    ? ["/token"]
    : ["/token", "/request-password-reset"],
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: {
      ...tables,
      sessions: authSessions,
      // The JWT plugin's key model is `jwks`, which the adapter looks up as
      // `${model}s` under `usePlural: true` -> `jwkss`. Alias it rather than
      // naming the table itself `jwkss`.
      jwkss: jwks,
    },
  }),

  secret: betterAuthSecret,
  baseURL: betterAuthUrl,
  // Better Auth trusts the origin of its own `baseURL`, which is a single
  // hostname — the API is reachable at several (localhost, a LAN address, a
  // public name). Non-browser clients such as dit
  // address it by whichever one the user configured and declare that as their
  // origin, so a request whose origin is the host it addressed is trusted too.
  trustedOrigins: (request) => {
    const own = sameOrigin(request);
    return own ? [...trustedOrigins, own] : trustedOrigins;
  },

  user: userOptions,

  // Who the instance belongs to, decided the only moment it can be: as the
  // account is created. `admitSignUp` either hands back the role the new
  // account gets — `admin` for the first one, which closes registration behind
  // it — or refuses the sign-up outright, which is what a closed instance
  // answers anyone holding no invite. A share-page guest is not an account and
  // skips all of it.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (isGuest(user)) return { data: user };

          const instanceRole = await admitSignUp(user.email);
          if (instanceRole == null) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed on this instance",
            });
          }

          return { data: { ...user, instanceRole } };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => ({
          data: {
            ...session,
            deviceName: deviceNameFrom(context?.request),
          },
        }),
      },
    },
  },

  // Only the session identity is cached, so a project role change still takes
  // effect on the next request — authorization reads `members` regardless, and
  // `isInstanceAdmin` reads `users.instanceRole` rather than the session's copy
  // of it for the same reason.
  //
  // The lifetime is read once, here, from the running policy: Better Auth
  // copies it out at construction, so a changed `sessionLifetimeDays` applies
  // from the next start, to the sessions created after it. `updateAge` is
  // derived from the same read, so the two never disagree.
  session: {
    expiresIn:
      runningInstancePolicy().access.sessionLifetimeDays * SECONDS_PER_DAY,
    updateAge: sessionUpdateAgeSeconds(
      runningInstancePolicy().access.sessionLifetimeDays
    ),
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
    additionalFields: {
      deviceName: { type: "string", required: false, input: false } as const,
    },
  },

  emailAndPassword: emailAndPasswordOptions,
  emailVerification: emailVerificationOptions,

  // Better Auth keys its limiter on a client address it can only read from
  // request headers, and nothing in front of this API sets one: Next's rewrite
  // forwards `x-forwarded-host` alone. Every caller therefore lands in one
  // shared per-path bucket, which turns a limit into a way for any one reader
  // to lock everybody out. The per-account lockout below needs no address at
  // all; `middleware/rate-limit.ts`'s `auth-signin` bucket (mounted in
  // `app.ts`, keyed on the caller's own address) covers how fast anyone can
  // drive it, and the per-caller limiter there covers every other route,
  // keyed on the user id.
  rateLimit: {
    enabled: false,
  },

  // Per-account brute-force lockout on `/sign-in/email`, keyed by
  // `emailHashOf` (`db/queries/signin-attempts.ts`) rather than a client
  // address, so it holds regardless of what sits in front of this API. A
  // locked account is refused before the password is ever checked, with the
  // same 429 body and `Retry-After` whether or not the address belongs to a
  // real account — the same enumeration guard `INVALID_EMAIL_OR_PASSWORD`
  // already gives a wrong password.
  //
  // The OAuth provider registers a client that names no `application_type`
  // as `web`, and a web client may only redirect to HTTPS off loopback, which
  // refuses the loopback callback RFC 8252 §7.3 has a CLI MCP client use. A
  // registration `isNativeRegistration` shows can only be a native app's is
  // registered as one, under the provider's own native redirect rules; every
  // other registration reaches the provider exactly as sent.
  //
  // The instance policy's own gates — self-deletion, guest sign-in and the
  // password length rule — run first, per request.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      assertAllowedByInstance(ctx.path);
      assertPasswordLength(ctx);
      await assertNotGuestReviewingDevice(ctx);
      if (ctx.path === "/oauth2/register" && isNativeRegistration(ctx.body)) {
        return {
          context: { body: { ...ctx.body, application_type: "native" } },
        };
      }
      if (ctx.path !== "/sign-in/email") return;
      const email = emailFromSignIn(ctx);
      if (email == null) return;
      const status = await checkLockout(email);
      if (status.locked) {
        throw new APIError(
          "TOO_MANY_REQUESTS",
          { message: "Too many failed sign-in attempts. Try again later." },
          { "Retry-After": String(status.retryAfterSeconds) }
        );
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = emailFromSignIn(ctx);
      if (email == null) return;
      if (ctx.context.newSession) {
        await clearLockout(email);
      } else if (isAPIError(ctx.context.returned)) {
        await recordFailure(email);
      }
    }),
  },
});

export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
  projectId?: number;
  role?: MemberRole;
};

/**
 * The context behind the `authenticated` middleware, where the identity is
 * already established. Route sub-apps are typed with this — they only ever
 * mount behind `authenticated` — so `c.get("user")` needs no assertion.
 * `projectId` and `role` are set by `authorizeProject` and are absent on the
 * mounts it does not gate.
 */
export type AuthedEnv = {
  Variables: {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
    projectId?: number;
    role?: MemberRole;
  };
};
