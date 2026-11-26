import { and, asc, eq, getTableColumns, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../index.js";
import { users } from "../schema/auth.js";
import { rawSavedViewKindEnum } from "../schema/enums.js";
import {
  editSavedViewSchema,
  newSavedViewSchema,
  type SavedView,
  savedViews,
  savedViewSchema,
  type SavedViewWithOwner,
  savedViewWithOwnerSchema,
} from "../schema/saved-views.js";
import { type MemberRole, roleSatisfies } from "./authorization.js";

export {
  savedViewSchema,
  savedViewWithOwnerSchema,
  newSavedViewSchema,
  editSavedViewSchema,
};

export const savedViewKindSchema = z.enum(rawSavedViewKindEnum);
export type SavedViewKind = z.infer<typeof savedViewKindSchema>;

/** The member a saved-view query acts for, and their role in the project. */
type Actor = { id: string; role: MemberRole };

/** The caller's own views plus every shared one, each with its owner. */
export async function getSavedViews(
  projectId: number,
  actor: Actor,
  kind?: SavedViewKind
): Promise<SavedViewWithOwner[]> {
  return db
    .select({
      ...getTableColumns(savedViews),
      owner: { id: users.id, name: users.name },
    })
    .from(savedViews)
    .innerJoin(users, eq(users.id, savedViews.ownerId))
    .where(
      and(
        eq(savedViews.projectId, projectId),
        kind ? eq(savedViews.kind, kind) : undefined,
        or(eq(savedViews.ownerId, actor.id), eq(savedViews.shared, true))
      )
    )
    .orderBy(asc(savedViews.name), asc(savedViews.id));
}

/**
 * Creates a view owned by the caller, or overwrites the caller's own view with
 * the same name for that kind. Another member's same-named view is untouched.
 */
export async function createSavedView(
  projectId: number,
  actor: Actor,
  data: z.infer<typeof newSavedViewSchema>
): Promise<SavedView> {
  const [row] = await db
    .insert(savedViews)
    .values({ ...data, projectId, ownerId: actor.id })
    .onConflictDoUpdate({
      target: [
        savedViews.projectId,
        savedViews.kind,
        savedViews.ownerId,
        savedViews.name,
      ],
      set: { config: data.config, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to create saved view");
  return row;
}

/**
 * The rows a write may touch. `(project, id)` is the pair the routes address,
 * so a view from another project is not found rather than rewritten. Unless
 * `anyOwner`, the view must also be the actor's own; the check sits in the
 * write's own WHERE, so there is no window in which another member's view
 * could change.
 */
function writableView(
  projectId: number,
  viewId: number,
  actor: Actor,
  anyOwner: boolean
) {
  return and(
    eq(savedViews.projectId, projectId),
    eq(savedViews.id, viewId),
    anyOwner ? undefined : eq(savedViews.ownerId, actor.id)
  );
}

/**
 * The owner edits their view; an admin or owner of the project may edit anyone's,
 * except whether it is shared, which is the owner's call alone. Anyone else
 * gets the 404 a missing view gets, whether or not the view is shared with
 * them.
 */
export async function updateSavedView(
  projectId: number,
  viewId: number,
  actor: Actor,
  data: z.infer<typeof editSavedViewSchema>
): Promise<SavedView> {
  const isAdmin = roleSatisfies(actor.role, "admin");
  const changesSharing = data.shared !== undefined;
  const [row] = await db
    .update(savedViews)
    .set({ ...data, updatedAt: new Date() })
    .where(writableView(projectId, viewId, actor, isAdmin && !changesSharing))
    .returning();
  if (row) return row;

  // An admin may change the rest of any view, so learning that this one exists
  // tells them nothing their role does not already let them find out.
  if (isAdmin && changesSharing) {
    const [existing] = await db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(writableView(projectId, viewId, actor, true));
    if (existing) {
      throw new HTTPException(403, {
        message: "Only the view's owner can share or unshare it",
      });
    }
  }
  throw new HTTPException(404);
}

/** The owner, or an admin or owner of the project, deletes a view. */
export async function deleteSavedView(
  projectId: number,
  viewId: number,
  actor: Actor
): Promise<SavedView> {
  const [row] = await db
    .delete(savedViews)
    .where(
      writableView(projectId, viewId, actor, roleSatisfies(actor.role, "admin"))
    )
    .returning();
  if (!row) throw new HTTPException(404);
  return row;
}
