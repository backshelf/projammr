import { requireMcpAuth } from "@better-auth/mcp";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthType } from "../auth.js";
import { auth } from "../auth.js";
import { mcpResource, trustedOrigins } from "../lib/env.js";
import { instancePolicy } from "../lib/instance-policy.js";
import { sameOrigin } from "../lib/origin.js";
import { selfUrl } from "../lib/self-origin.js";
import { spendToken } from "../middleware/rate-limit.js";
import { authInfoFor, loadActor } from "./actor.js";
import { requireScope } from "./authorize.js";
import { createMcpHandlerFor, toolScope } from "./registry.js";
import type { AnyToolSpec, ResourceSpec } from "./spec.js";
import { RESOURCES } from "./resources/index.js";
import { TOOLS } from "./tools/index.js";
import { MCP_SCOPES } from "@workspace/settings/groups/instance-integrations";

/**
 * A browser-originated request must declare an origin this API trusts; a
 * request with no `Origin` header (Claude Code, any non-browser client)
 * passes. Rejecting an untrusted origin is what the transport specification
 * requires against DNS rebinding — CORS alone only withholds headers from a
 * browser, it never refuses the request itself.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")?.toLowerCase();
  if (!origin) return true;
  return trustedOrigins.includes(origin) || sameOrigin(request) === origin;
}

function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    ""
  );
}

/**
 * The tool a `tools/call` request names, read from a clone of the body so the
 * SDK still sees an unconsumed stream. Answers `undefined` for anything that
 * is not a well-formed single `tools/call` request — a different method, a
 * malformed body, or a batch — which is left to the SDK to answer.
 */
/**
 * The scopes a 401 challenge asks a client to request: `read`, which every
 * token needs, and every other scope the instance offers
 * (`integrations.mcpToolGroups`, read per request). A client takes the
 * challenge's `scope` over the metadata's `scopes_supported`, so a scope left
 * out here never reaches the consent page at all.
 */
function challengeScopes(): string[] {
  const offered = instancePolicy().integrations.mcpToolGroups;
  return MCP_SCOPES.filter(
    (scope) => scope === "read" || offered.includes(scope)
  );
}

async function calledToolName(request: Request): Promise<string | undefined> {
  try {
    const body = (await request.clone().json()) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    if (body.method !== "tools/call") return undefined;
    return typeof body.params?.name === "string" ? body.params.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `/mcp` sub-app, parameterised over the tool and resource lists so a
 * test can drive the same origin guard, bearer auth and rate limiting with
 * fixture specs; the default export below is what production mounts.
 */
export function createMcpRoute(
  tools: readonly AnyToolSpec[] = TOOLS,
  resources: readonly ResourceSpec[] = RESOURCES
): Hono<{ Variables: AuthType }> {
  const app = new Hono<{ Variables: AuthType }>();
  const handler = createMcpHandlerFor(tools, resources);

  app.post("/", async (c) => {
    if (!originAllowed(c.req.raw)) {
      throw new HTTPException(403, { message: "Origin not allowed" });
    }

    // Built per request so it can close over `c`: the actor it loads is what
    // the request log line and the rate limiter both key on, and a bearer
    // token — not a cookie — is what names the caller here.
    const protectedPost = requireMcpAuth(
      auth,
      async (request, claims) => {
        const actor = await loadActor(claims);
        c.set("user", actor.user);
        spendToken("mcp", actor.id);

        // A named write tool a read-only token cannot use is refused here,
        // before the SDK ever dispatches it: `requireScope` throws the
        // insufficient-scope error `requireMcpAuth`'s own try/catch turns
        // into an RFC 6750 step-up challenge. The tool callback repeats this
        // check as defence in depth, but an error thrown there reaches only
        // the SDK's own `tools/call` handling, which folds it into an
        // ordinary `isError` result rather than a challenge.
        const name = await calledToolName(request);
        if (name) {
          const scope = toolScope(name, tools);
          if (scope) requireScope(actor, scope);
        }

        return handler.fetch(request, {
          authInfo: authInfoFor(actor, claims, bearerToken(request)),
        });
      },
      {
        resource: mcpResource,
        requiredScopes: ["read"],
        challengeScopes: challengeScopes(),
        // The provider's keys, from this process rather than the public URL,
        // which the container cannot reach over TLS (see lib/self-origin.ts).
        jwksUrl: selfUrl("/api/auth/jwks"),
      }
    );

    return protectedPost(c.req.raw);
  });

  return app;
}

export default createMcpRoute();
