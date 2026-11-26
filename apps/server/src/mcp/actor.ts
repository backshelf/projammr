import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import type { McpScope } from "@workspace/settings/groups/instance-integrations";

/** The two scopes the MCP OAuth provider grants: read access, and write access gated behind it. */
export type Scope = McpScope;

/**
 * The bearer JWT claims `requireMcpAuth` hands to its callback: the
 * registered `sub`, and `scope`/`client_id`/`azp`, which the OAuth provider
 * sets as custom claims rather than registered ones.
 */
export type McpClaims = {
  sub?: string;
  scope?: string;
  client_id?: string;
  azp?: string;
};

/**
 * The verified caller of an MCP request. `user` is the same shape
 * `resolveSession` puts on a cookie-authenticated request, so `c.set("user",
 * actor.user)` in `route.ts` is what lets `requestLog` and the activity log
 * read the MCP caller with no branch of their own.
 */
export type Actor = {
  id: string;
  name: string;
  scopes: ReadonlySet<Scope>;
  user: typeof auth.$Infer.Session.user;
};

const SCOPES: readonly Scope[] = ["read", "write"];

function stringClaim(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseScopes(scopeClaim: unknown): ReadonlySet<Scope> {
  const granted = new Set(stringClaim(scopeClaim).split(" "));
  return new Set(SCOPES.filter((scope) => granted.has(scope)));
}

/**
 * The verified token's subject, as a `users` row; a token for a deleted or
 * disabled user is 401 rather than a crash or bypass, since `requireMcpAuth`
 * only checks the JWT's signature and claims and never whether the row behind
 * `sub` is still active. A share-page guest's anonymous session is refused with
 * the same 403 the `authenticated` middleware answers a cookie caller with —
 * MCP has no guest-facing surface for it to reach.
 */
export async function loadActor(claims: McpClaims): Promise<Actor> {
  const id = stringClaim(claims.sub);
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new HTTPException(401, { message: "Unknown user" });
  if (user.disabledAt != null) {
    throw new HTTPException(401, { message: "Account disabled" });
  }
  if (user.isAnonymous) {
    throw new HTTPException(403, { message: "This needs an account" });
  }
  return {
    id: user.id,
    name: user.name,
    scopes: parseScopes(claims.scope),
    user,
  };
}

/**
 * The SDK's per-request auth context: `token`, `clientId` and `scopes` for
 * whatever the SDK itself wants to report, and the actor under `extra` so a
 * tool or resource handler recovers it through `actorFrom` with no second
 * lookup.
 */
export function authInfoFor(
  actor: Actor,
  claims: McpClaims,
  token: string
): AuthInfo {
  return {
    token,
    clientId: stringClaim(claims.client_id) || stringClaim(claims.azp),
    scopes: [...actor.scopes],
    extra: { actor },
  };
}

/** The inverse of `authInfoFor`: the actor a tool or resource handler runs as. */
export function actorFrom(authInfo: AuthInfo | undefined): Actor {
  const actor = authInfo?.extra?.actor;
  if (!actor) {
    throw new Error("MCP request carries no actor in authInfo.extra");
  }
  return actor as Actor;
}

/**
 * The actor as the request context the activity-log helpers read the caller
 * from, so an MCP write records its activity under the same user a cookie
 * request would.
 */
export function activityContext(actor: Actor): { get: () => Actor["user"] } {
  return { get: () => actor.user };
}
