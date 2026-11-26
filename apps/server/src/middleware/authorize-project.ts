import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthType } from "../auth.js";
import {
  isInstanceAdmin,
  requireMembership,
  type MemberRole,
  type Scope,
} from "../db/queries/authorization.js";

/**
 * The project a request was authorized against. `authorizeProject` stores it
 * before the handler runs, so a handler scoping a foreign id from the body
 * reads the gated project rather than resolving one of its own. Absent only on
 * a mount with no project gate, where there is nothing to scope to.
 */
export function gatedProject(c: {
  get: (key: "projectId") => number | undefined;
}): number {
  const projectId = c.get("projectId");
  if (projectId == null) {
    throw new HTTPException(403, {
      message: "Request is not scoped to a project",
    });
  }
  return projectId;
}

/**
 * The caller's role in the project the request was authorized against, for a
 * handler whose answer depends on the actor's rank. Absent only on a mount
 * with no project gate, where there is no role to have.
 */
export function gatedRole(c: {
  get: (key: "role") => MemberRole | undefined;
}): MemberRole {
  const role = c.get("role");
  if (role == null) {
    throw new HTTPException(403, {
      message: "Request is not scoped to a project",
    });
  }
  return role;
}

/**
 * Turns a request into the `Scope` it targets: a project to gate on
 * membership, a user-owned row (an avatar) to gate on ownership, seeded
 * instance-wide vocabulary, a route that is not scoped to any stored row at
 * all (creating a project, accepting an invite with a token, reading one's
 * own account), or `null` when the target does not exist → 404.
 */
export type ProjectIdResolver = (
  c: Context<{ Variables: AuthType }>,
  userId: string
) => Promise<Scope> | Scope;

/**
 * Whether a method only reads. `authorizeProject` uses it for the roles a
 * `Scope` needs no write check against; the entity resolvers reuse it to tell
 * a route with no bare-read mount (every write carries its project in the
 * body) from an id-less GET that matches no route at all.
 */
export function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * The minimum role a request needs, by HTTP method. Reads need `viewer`;
 * anything that mutates needs `editor`. A mount whose writes are more
 * sensitive (member management, project deletion) raises the bar via
 * `overrides`.
 */
type RoleByMethod = Partial<Record<string, MemberRole>> & {
  default: MemberRole;
};

/**
 * How a mount decides the minimum role for a request. Either a static
 * method→role map, or a function that inspects the request — member management
 * lives under `/projects/*` but needs `admin` for its writes, which the path
 * alone distinguishes.
 */
export type RolePolicy =
  | Partial<RoleByMethod>
  | ((c: Context<{ Variables: AuthType }>) => MemberRole | undefined);

const defaultRoles: RoleByMethod = {
  GET: "viewer",
  HEAD: "viewer",
  default: "editor",
};

/**
 * Gates a mounted route on the `Scope` the request targets. `resolveProjectId`
 * turns the request into a `Scope` — a project directly for `/projects`, via a
 * carried `projectId` for collections/tracks/sessions, through a target
 * lookup for comments/assets/images. A request that resolves to no row at
 * all, or a project whose caller is not a member of it, gets a 404 (no
 * existence leak to an outsider); a member below the required role, or a
 * non-admin writing an instance-scoped row, gets 403, since they already know
 * the row exists.
 */
export function authorizeProject(
  resolveProjectId: ProjectIdResolver,
  policy: RolePolicy = {}
) {
  const roles: RoleByMethod =
    typeof policy === "function"
      ? defaultRoles
      : { ...defaultRoles, ...policy };

  return createMiddleware<{ Variables: AuthType }>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new HTTPException(401);

    const scope = await resolveProjectId(c, user.id);
    if (scope == null) throw new HTTPException(404);

    switch (scope.kind) {
      case "none":
        return next();

      case "user":
        // Only the row's own owner passes; anyone else gets the same 404 a
        // missing row gets, rather than confirming that someone else's
        // avatar exists.
        if (scope.id !== user.id) throw new HTTPException(404);
        return next();

      case "instance":
        if (!isReadMethod(c.req.method) && !(await isInstanceAdmin(user.id))) {
          throw new HTTPException(403, {
            message: "Only an instance admin can change this",
          });
        }
        return next();

      case "project": {
        const minRole =
          (typeof policy === "function" ? policy(c) : undefined) ??
          roles[c.req.method] ??
          roles.default;

        const role = await requireMembership(user.id, scope.id, minRole);

        // The gated project and the caller's role in it, so handlers read
        // them instead of resolving and querying a second time.
        c.set("projectId", scope.id);
        c.set("role", role);

        return next();
      }
    }
  });
}
