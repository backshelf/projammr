import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../../db/index.js";
import type { MemberRole } from "../../db/queries/authorization.js";
import { projectAttachments } from "../../db/schema/attachments.js";
import {
  editProjectSchema,
  type NewProject,
  newProjectSchema,
  projects,
  projectSchema,
} from "../../db/schema/projects.js";
import { pathId, unscoped } from "../../middleware/request-refs.js";
import { defineEntity, projectIdOfSelf } from "../shared.js";
import type { AttachmentJoin } from "../types.js";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectRow,
  projectDetailSchema,
  updateProject,
} from "./queries.js";

const attachments: AttachmentJoin = {
  table: projectAttachments,
  entityColumn: projectAttachments.projectId,
  assetColumn: projectAttachments.assetId,
  link: async (projectId, assetId) => {
    const [row] = await db
      .insert(projectAttachments)
      .values({ projectId, assetId })
      .onConflictDoNothing()
      .returning();
    return row;
  },
};

/**
 * Project deletion is owner-only; changing or removing members is admin-only.
 * Everything else follows the default read/write split.
 */
function policy(c: Context): MemberRole | undefined {
  // Who may create an invite is the project's own setting, from editors up
  // to the owner alone, so the gate lets the lowest of those through and
  // `createInvite` holds the rest. Listing invites exposes email addresses,
  // so it stays admin-only; the member list stays viewer-readable, and every
  // member write is admin-only.
  if (/\/invites(\/|$)/.test(c.req.path)) {
    return c.req.method === "POST" ? "editor" : "admin";
  }
  if (c.req.method !== "GET" && /\/members(\/|$)/.test(c.req.path)) {
    return "admin";
  }
  // Ending one's own membership is not member management: every member may
  // walk away, including a viewer who cannot otherwise write.
  if (c.req.method === "POST" && /\/leave$/.test(c.req.path)) return "viewer";
  if (c.req.method === "DELETE" && /\/projects\/\d+$/.test(c.req.path)) {
    return project.deleteRole;
  }
  if (c.req.method === "POST" && /\/transfer-ownership$/.test(c.req.path)) {
    return "owner";
  }
  // A backfill spends real server time on every audio file in the project.
  if (/\/audio-backfill$/.test(c.req.path)) return "admin";
  return undefined;
}

export const project = defineEntity({
  kind: "project",
  mountPath: "/projects",
  label: "Project",
  table: projects,
  // A project is its own scope, so "the project this row belongs to" is its
  // own primary key — which is what makes the shared resolver and the
  // in-project assertion answer correctly for it.
  projectColumn: projects.id,
  nameColumn: projects.name,
  notesField: "description",
  image: {
    set: async (id, assetPath) => {
      const [row] = await db
        .update(projects)
        .set({ image: assetPath })
        .where(eq(projects.id, id))
        .returning({ id: projects.id });
      return row != null;
    },
  },
  attachments,
  policy,
  // A project has no parent project: `POST /projects` names none, unlike
  // every other entity's create, which `resolveEntityRoute` refuses without
  // one. `/projects/:id/*` still gates on the project itself — a nonexistent
  // id needs no separate existence check, since `requireMembership` already
  // 404s a project nobody (this caller included) is a member of.
  resolveRoute: (c) => {
    const id = pathId(c);
    return id == null ? unscoped : { kind: "project", id };
  },
  // The scanner and the client's project-creation flow are the only ways to
  // make a project; MCP ships `create_track` and `create_collection` only.
  mcpCreate: false,
  // The REST route requires owner to delete a project; the MCP `delete_project`
  // tool gates on the same rank.
  deleteRole: "owner",
  schemas: {
    row: projectSchema,
    detail: projectDetailSchema,
    create: newProjectSchema,
    edit: editProjectSchema,
  },
  recordsDelete: false,
  // The authorizeProject middleware required viewer membership to reach the
  // handler, so the caller's role is already resolved.
  load: async (id, role) => ({ ...(await getProject(id)), role }),
  row: getProjectRow,
  create: (data: NewProject, actor) => createProject(data, actor.userId),
  update: (id, patch: Partial<NewProject>) => updateProject(id, patch),
  remove: deleteProject,
  projectIdOfRow: projectIdOfSelf,
});
