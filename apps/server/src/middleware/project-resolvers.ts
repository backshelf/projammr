import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { projectIdForAsset } from "../db/queries/assets.js";
import {
  projectIdForComment,
  projectIdForCommentTarget,
} from "../db/queries/comments.js";
import {
  isInstanceAdmin,
  projectScope,
  type Scope,
} from "../db/queries/authorization.js";
import { projectIdForCommit, projectIdForSave } from "../db/queries/commits.js";
import { projectIdForImage } from "../db/queries/images.js";
import { projectIdForInvite } from "../db/queries/invites.js";
import { projectIdForJob } from "../db/queries/jobs.js";
import { projectIdForRepo } from "../db/queries/repos.js";
import { INSTANCE_TARGET_ID } from "../db/queries/settings.js";
import {
  GLOBAL_STATUS_CHANGE_REFUSAL,
  GLOBAL_STATUS_DELETE_REFUSAL,
  projectIdForStatus,
} from "../db/queries/statuses.js";
import { projectIdForTrackAudio } from "../db/queries/track-audios.js";
import { rawCommentTargetEnum } from "../db/schema/enums.js";
import { ENTITIES, isEntityKind } from "../entities/index.js";
import type { EntityModule } from "../entities/types.js";
import { isReadMethod, type ProjectIdResolver } from "./authorize-project.js";
import {
  numberOf,
  pathId,
  positiveInt,
  readBody,
  requireProjectInBody,
  segments,
  unscoped,
} from "./request-refs.js";

/**
 * The resolvers for the mounts that are not entities. Every entity mount is
 * resolved by `resolveEntityRoute` below, from the module itself.
 */

/**
 * How an entity mount resolves to a project: the row named in the path, or the
 * `projectId` a create carries — always required, since every entity but
 * `project` itself belongs to one. A module whose bodies name rows in other
 * ways — the session bulk routes, `project` itself — supplies its own
 * `resolveRoute`.
 */
export function resolveEntityRoute(m: EntityModule): ProjectIdResolver {
  if (m.resolveRoute) return m.resolveRoute;
  return async (c) => {
    const id = pathId(c);
    if (id != null) return projectScope(await m.projectIdFor(id));
    // A read with no third path segment at all (`GET /<kind>`) matches no
    // route — no entity mount has a bare one. A read whose third segment
    // doesn't parse as an id (`GET /tracks/not-a-number`) still matches
    // `/:id`; passing it through unscoped lets that route's own id validator
    // turn it into a 400 rather than this resolver preempting it with a 404.
    // Every id-less write does exist, though: the `POST` create and, when the
    // module lists, the `PATCH`/`DELETE /bulk` routes, and both carry their
    // `projectId` in the body.
    if (isReadMethod(c.req.method)) {
      return segments(c)[2] === undefined ? null : unscoped;
    }
    return requireProjectInBody(c);
  };
}

export const resolveTrackAudioRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  return id == null ? null : projectScope(await projectIdForTrackAudio(id));
};

/**
 * `POST /comments` carries `targetType` + `targetId` in the body; the other
 * comment routes address a comment by id.
 */
export const resolveCommentRoute: ProjectIdResolver = async (c) => {
  const seg = segments(c);
  // GET /comments/:targetType/:targetId — read comments for an entity.
  const targetTypeFromPath = z.enum(rawCommentTargetEnum).safeParse(seg[2]);
  if (targetTypeFromPath.success) {
    const targetId = positiveInt(seg[3]);
    return targetId == null
      ? null
      : projectScope(
          await projectIdForCommentTarget(targetTypeFromPath.data, targetId)
        );
  }

  // PATCH / DELETE /comments/:id — address a comment directly.
  const id = pathId(c);
  if (id != null) return projectScope(await projectIdForComment(id));

  // POST /comments — target named in the body.
  try {
    const body = await c.req.json();
    const targetType = z.enum(rawCommentTargetEnum).safeParse(body?.targetType);
    const targetId = Number(body?.targetId);
    if (!targetType.success || Number.isNaN(targetId)) return null;
    return projectScope(
      await projectIdForCommentTarget(targetType.data, targetId)
    );
  } catch {
    return null;
  }
};

/**
 * `POST /statuses` names its project in the body — required, so a create
 * naming none is a 400, not an instance-wide row. `GET` / `PATCH`
 * / `DELETE /statuses/:id` address a status that may be a seeded global one
 * or a project status; a global one is instance-scoped, so every signed-in
 * caller reads it, and a write to it is refused for everyone, instance admin
 * included, before the admin gate is reached.
 */
export const resolveStatusRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  if (id == null) {
    // The statuses mount has no list route — `GET /projects/:id/statuses` is
    // the list — so a bare `GET /statuses` matches nothing and 404s here
    // rather than falling through. A segment that is no id
    // (`/statuses/not-a-number`) does fall through, unscoped, so that the
    // `GET`/`PATCH`/`DELETE /:id` validator answers it with a 400. The only
    // id-less write is the `POST` create, and it carries its `projectId` in
    // the body.
    if (isReadMethod(c.req.method)) {
      return segments(c)[2] === undefined ? null : unscoped;
    }
    return requireProjectInBody(c);
  }

  const resolution = await projectIdForStatus(id);
  if (resolution === "global") {
    if (isReadMethod(c.req.method)) return { kind: "instance" };
    throw new HTTPException(403, {
      message:
        c.req.method === "DELETE"
          ? GLOBAL_STATUS_DELETE_REFUSAL
          : GLOBAL_STATUS_CHANGE_REFUSAL,
    });
  }
  return projectScope(resolution);
};

/**
 * `DELETE /invites/:id` is gated on the project (admin, set at the mount).
 * `POST /invites/:token/accept` is how a not-yet-member joins, so it cannot be
 * gated on membership — authentication alone, and the token itself is what
 * `acceptInvite` checks.
 */
export const resolveInviteRoute: ProjectIdResolver = async (c) => {
  const seg = segments(c);
  if (seg[3] === "accept") return unscoped;
  return seg[2] ? projectScope(await projectIdForInvite(seg[2])) : null;
};

/**
 * `POST /assets/upload` names its project in the form body — required, an
 * asset always belongs to one; `/assets/project/:projectId`, `DELETE
 * /assets/:id` and `POST /assets/:id/convert` address it by param.
 */
export const resolveAssetRoute: ProjectIdResolver = async (c) => {
  const seg = segments(c);
  if (seg[2] === "project") {
    const projectId = positiveInt(seg[3]);
    return projectId == null
      ? null
      : projectScope(await ENTITIES.project.projectIdFor(projectId));
  }

  const id = pathId(c);
  if (id != null) return projectScope(await projectIdForAsset(id));

  // The routes that address one asset (`GET /:id`, `DELETE /:id`,
  // `POST /:id/convert`) resolve through the path id above; a bare or
  // malformed id-less read matches nothing here. Both id-less writes (`/upload`, `/lookup`) carry their `projectId`
  // in the body.
  if (isReadMethod(c.req.method)) {
    return segments(c)[2] === undefined ? null : unscoped;
  }
  return requireProjectInBody(c);
};

/** `/jobs/:id` — the job carries the project whose members may read it. */
export const resolveJobRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  return id == null ? null : projectScope(await projectIdForJob(id));
};

/** `/commits/:id` — the commit carries, through its repo, the project whose members may read it. */
export const resolveCommitRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  return id == null ? null : projectScope(await projectIdForCommit(id));
};

/** `/saves/:id` — the save names the project whose members may read it. */
export const resolveSaveRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  return id == null ? null : projectScope(await projectIdForSave(id));
};

/**
 * `/samples/:hash?repo=<id>` — a sample is addressed within the repo the
 * query names, which carries the project whose members may read it. A missing
 * or malformed `repo` matches no repo.
 */
export const resolveSampleRoute: ProjectIdResolver = async (c) => {
  const repo = c.req.query("repo");
  const id = positiveInt(repo);
  return id == null ? null : projectScope(await projectIdForRepo(id));
};

/**
 * `/repos/:id` and everything under it: the repo carries the project whose
 * members may read it. Reads only the path's `:id`, so any route mounted under
 * a repo is gated by it.
 */
export const resolveRepoRoute: ProjectIdResolver = async (c) => {
  const id = pathId(c);
  return id == null ? null : projectScope(await projectIdForRepo(id));
};

/**
 * How each settings scope a `/settings` route names is gated, from the id it
 * is addressed by: the user scope passes the caller's own id only, a project
 * gates on membership, the instance (`INSTANCE_TARGET_ID`, or no id where the
 * id is a query parameter) is an instance admin's alone — anyone else gets the
 * 404 `/admin/*` gives. A
 * scope with no entry here 404s.
 */
const SETTINGS_SCOPES: Record<
  string,
  (id: string | undefined, userId: string) => Promise<Scope> | Scope
> = {
  user: (id) => (id === undefined ? null : { kind: "user", id }),
  project: async (id) => {
    const projectId = positiveInt(id);
    return projectId == null
      ? null
      : projectScope(await ENTITIES.project.projectIdFor(projectId));
  },
  instance: async (id, userId) =>
    (id === undefined || id === INSTANCE_TARGET_ID) &&
    (await isInstanceAdmin(userId))
      ? { kind: "instance" }
      : null,
};

const settingsScope = (
  scope: string | undefined,
  id: string | undefined,
  userId: string
): Promise<Scope> | Scope =>
  scope !== undefined && Object.hasOwn(SETTINGS_SCOPES, scope)
    ? SETTINGS_SCOPES[scope]!(id, userId)
    : null;

/**
 * `/settings`: the two reads name their project in the `project` query
 * (absent: the caller's own settings over the instance's), the change log
 * names its scope and id in the query, and every other route names them in the
 * path, `/settings/:scope/:id…`. A query naming no scope or one the route does
 * not take passes through unscoped for the route's own validator to answer
 * with a 400.
 */
export const resolveSettingsRoute: ProjectIdResolver = (c, userId) => {
  const route = segments(c)[2];
  if (route === undefined || route === "effective") {
    const project = c.req.query("project");
    return project === undefined
      ? unscoped
      : settingsScope("project", project, userId);
  }
  if (route === "audit") {
    const scope = c.req.query("scope");
    return scope === undefined || !Object.hasOwn(SETTINGS_SCOPES, scope)
      ? unscoped
      : settingsScope(scope, c.req.query("id"), userId);
  }
  const [, , scope, id] = segments(c);
  return settingsScope(scope, id, userId);
};

/**
 * `PUT` and `DELETE /images/parent/:kind/:parentId` name the parent in the
 * path and are gated on that parent's project, for any method;
 * `/images/project/:projectId` addresses it by param. The `/images/:id`
 * branch gates every id-addressed route, including an avatar, which
 * `projectIdForImage` answers with a `user` scope for, and an instance image,
 * with the `instance` scope. `POST /images/upload` carries `projectId` only for
 * a project-scoped image; a body naming none is an avatar upload, scoped to
 * its own uploader rather than refused. `POST /images/instance` is an instance
 * admin's alone; anyone else gets the 404 `/admin/*` gives.
 */
export const resolveImageRoute: ProjectIdResolver = async (c, userId) => {
  const seg = segments(c);
  if (seg[2] === "instance") {
    return (await isInstanceAdmin(userId)) ? { kind: "instance" } : null;
  }
  if (seg[2] === "project") {
    const projectId = positiveInt(seg[3]);
    return projectId == null
      ? null
      : projectScope(await ENTITIES.project.projectIdFor(projectId));
  }

  if (seg[2] === "parent") {
    const kind = seg[3];
    const parentId = positiveInt(seg[4]);
    if (parentId == null || kind == null || !isEntityKind(kind)) return null;
    return projectScope(await ENTITIES[kind].projectIdFor(parentId));
  }

  const id = pathId(c);
  if (id != null) return projectIdForImage(id);

  const body = await readBody(c);
  const projectId = numberOf(
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).projectId
      : null
  );
  return projectId == null
    ? { kind: "user", id: userId }
    : { kind: "project", id: projectId };
};
