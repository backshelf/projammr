import type { MemberRole, SavedView } from "@workspace/api/api";

/** What a saved view's trailing menu should offer the caller. */
export type SavedViewActions = { share: boolean; delete: boolean };

/**
 * The one rule both the desktop menu and the phone sheet apply to a saved
 * view's row, so the two surfaces cannot drift apart. Mirrors the server's
 * gate: PATCH and DELETE both require at least the editor role before the
 * owner-or-admin check, so a viewer gets neither action even on a view they
 * own. An unreadable caller id (`me === ""`) or a `null` role (outside a
 * project route) gets no write affordances at all, admin delete included.
 */
export function savedViewActions(
  view: Pick<SavedView, "ownerId">,
  me: string,
  can: ((minRole: MemberRole) => boolean) | null
): SavedViewActions {
  if (me === "" || !can) return { share: false, delete: false };
  const isOwner = view.ownerId === me;
  return {
    share: isOwner && can("editor"),
    delete: (isOwner && can("editor")) || can("admin"),
  };
}
