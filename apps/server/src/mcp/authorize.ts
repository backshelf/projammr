import { createInsufficientScopeError } from "better-auth/oauth2";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import {
  projectScope,
  requireMembership,
  type MemberRole,
  type Scope as ResourceScope,
} from "../db/queries/authorization.js";
import { ENTITIES, type EntityKind } from "../entities/index.js";
import type { Actor, Scope } from "./actor.js";

export type Gate = { projectId: number; role: MemberRole };

/**
 * The actor's role in a project, at least `minRole`. A non-member gets the
 * same `<label> not found` 404 a missing row gets (no existence leak to an
 * outsider); a member below `minRole` gets the same 403 text the HTTP gate
 * uses, since they already know the row exists.
 */
export async function requireProject(
  actor: Actor,
  projectId: number,
  minRole: MemberRole,
  label = "project"
): Promise<Gate> {
  const role = await requireMembership(
    actor.id,
    projectId,
    minRole,
    `${label} not found`
  );
  return { projectId, role };
}

/**
 * Gates on a resolver's answer: a `Scope` that names no row, or a project the
 * actor is not a member of, both 404 with the same `<label> not found`,
 * otherwise `requireProject` at `minRole`. `requireEntity` is this for the
 * entity registry's resolvers; a resolver outside it (a track audio, a job)
 * calls this directly rather than growing its own copy. Every MCP tool acts
 * on a project today, so only the `project` kind is handled — a `user` or
 * `instance` scope (REST-only, for avatars and seeded statuses) 404s the same
 * as a missing row rather than being silently authorized.
 */
export async function requireResolved(
  actor: Actor,
  scope: ResourceScope,
  label: string,
  minRole: MemberRole
): Promise<Gate> {
  if (scope == null || scope.kind !== "project") {
    throw new HTTPException(404, { message: `${label} not found` });
  }
  return requireProject(actor, scope.id, minRole, label);
}

/** Resolves an entity to its project (404 for a missing or foreign row, no existence leak) and gates on it. */
export async function requireEntity(
  actor: Actor,
  kind: EntityKind,
  id: number,
  minRole: MemberRole
): Promise<Gate> {
  const projectId = await ENTITIES[kind].projectIdFor(id);
  return requireResolved(actor, projectScope(projectId), kind, minRole);
}

/**
 * Every write tool calls this before touching anything. Thrown through
 * `createInsufficientScopeError` rather than a plain `HTTPException`: the
 * OAuth provider's `createResourceServerChallenge` only recognises a failure
 * built that way, so an insufficient-scope error that escapes a tool's own
 * try/catch reaches `requireMcpAuth`'s built-in RFC 6750 step-up challenge
 * instead of a hand-built header.
 */
export function requireScope(actor: Actor, scope: Scope): void {
  if (!actor.scopes.has(scope)) {
    throw createInsufficientScopeError([scope]);
  }
}

export type ToolFailure = { status: number; message: string };

/**
 * A tool's failure is a tool-execution error the model can act on (an
 * `isError` result), never a JSON-RPC error: 403/404/409 from the query layer
 * and 400 from input validation all carry text the model can recover from.
 * Anything else — including the insufficient-scope error `requireScope`
 * throws — is rethrown so it reaches the transport instead of being folded
 * into a text result.
 */
export function toolFailure(err: unknown): ToolFailure {
  if (err instanceof HTTPException) {
    return { status: err.status, message: err.message || String(err.status) };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      message: err.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }
  throw err;
}
