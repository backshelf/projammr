import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Scope } from "../db/queries/authorization.js";

/**
 * Reading the ids a request names, before any handler has run. The project
 * resolvers and the entity modules both work from these, so neither has to
 * re-derive what a URL or a body is pointing at.
 */

/** Path split into non-empty segments: `["api", "<resource>", ...]`. */
export function segments(c: Context): string[] {
  return c.req.path.split("/").filter(Boolean);
}

export function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The entity id a request addresses, read straight from the URL.
 *
 * `authorizeProject` is mounted with `app.use("/<resource>/*", ...)`, and Hono
 * does not expose a downstream route's `:id` param to a wildcard middleware, so
 * the id is taken as the segment after `/api/<resource>/` when it is a positive
 * integer. `/api/tracks/42/audios` and `/api/collections/5/tracks/9` both yield
 * the leading resource id (42, 5). Non-numeric leading segments
 * (`/api/assets/upload`, `/api/sessions/bulk`, `/api/statuses`) yield null.
 */
export function pathId(c: Context): number | null {
  return positiveInt(segments(c)[2]);
}

/**
 * Reads the request body once for a resolver. Hono memoizes the parsed body,
 * so the handler's own `c.req.valid(...)` still sees it.
 */
export async function readBody(c: Context): Promise<unknown> {
  try {
    const isJson =
      c.req.header("content-type")?.includes("application/json") ?? true;
    return isJson ? await c.req.json() : await c.req.parseBody();
  } catch {
    return null;
  }
}

export function numberOf(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    return positiveInt(value.trim());
  }
  return null;
}

/**
 * A create whose project is not optional: absent or non-numeric `projectId`
 * is the caller's error (400), never "this route must not be project-scoped".
 * The generic entity fallback (`resolveEntityRoute`) and every other create
 * that always belongs to a project use this; a create that can legitimately
 * name no project (an avatar upload) reads the body itself instead.
 */
export async function requireProjectInBody(c: Context): Promise<Scope> {
  const body = await readBody(c);
  const id = numberOf(
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).projectId
      : null
  );
  if (id == null) {
    throw new HTTPException(400, { message: "projectId is required" });
  }
  return { kind: "project", id };
}

/** A route that acts on no stored row: creating a project, accepting an invite by token. */
export const unscoped: Scope = { kind: "none" };
