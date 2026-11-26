import type { InstanceUser } from "@workspace/api/api";

type UserRow = Pick<InstanceUser, "id" | "instanceRole" | "disabled">;

/**
 * Whether `target` is the one enabled admin among `page` — the client-side
 * courtesy that disables the demote and disable controls up front. It reads
 * only the rows this page loaded, so a wrongly-paginated admin on an instance
 * with hundreds of accounts could still slip past this check; the server's
 * own 409 (`changeInstanceUser`) is what actually guards the invariant.
 */
export function isOnlyEnabledAdmin(
  target: UserRow,
  page: readonly UserRow[]
): boolean {
  if (target.instanceRole !== "admin" || target.disabled) return false;

  const enabledAdmins = page.filter(
    (user) => user.instanceRole === "admin" && !user.disabled
  );
  return enabledAdmins.length === 1 && enabledAdmins[0]?.id === target.id;
}

/** What the reset-link dialog shows: nothing, or the one link just minted
 *  for one user. Closing the dialog clears it — there is nowhere in this
 *  state for a stale link to be reread from, so the value really is shown
 *  once per mint. */
export type ResetLinkDialogState = { userId: string; url: string } | null;

export type ResetLinkDialogAction =
  { type: "shown"; userId: string; url: string } | { type: "closed" };

export function resetLinkDialogReducer(
  _state: ResetLinkDialogState,
  action: ResetLinkDialogAction
): ResetLinkDialogState {
  return action.type === "shown"
    ? { userId: action.userId, url: action.url }
    : null;
}
