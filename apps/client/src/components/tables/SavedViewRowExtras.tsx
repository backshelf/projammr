"use client";

import { useProjectRole } from "@/hooks/use-project-role";
import { IconDotsVertical, IconUsers } from "@tabler/icons-react";
import type { SavedView } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import { savedViewActions } from "./saved-view-actions";

/**
 * What trails a saved view's name in the desktop picker and the phone sheet
 * alike: the shared mark with the owner's name on a view that is not the
 * caller's, and a menu with whichever of Share/Unshare and Delete
 * `savedViewActions` allows, plus Set as default / Clear default, which any
 * member may use regardless of that rule — it is a personal setting, not a
 * change to the view. Delete only asks: the caller owns the confirm.
 */
export function SavedViewRowExtras({
  view,
  me,
  iconSize,
  onShare,
  onRequestDelete,
  isDefault,
  onSetDefault,
  onClearDefault,
}: {
  view: SavedView;
  me: string;
  iconSize: number;
  onShare: (viewId: number, shared: boolean) => Promise<boolean>;
  onRequestDelete: (view: SavedView) => void;
  isDefault: boolean;
  onSetDefault: (viewId: number) => Promise<boolean>;
  onClearDefault: (viewId: number) => Promise<boolean>;
}) {
  const role = useProjectRole();
  const actions = savedViewActions(view, me, role?.can ?? null);
  const sharedBy = `Shared by ${view.owner.name}`;

  return (
    <>
      {view.ownerId !== me && (
        <span title={sharedBy} className="shrink-0 text-ink-soft">
          <IconUsers aria-hidden size={iconSize} />
          <span className="sr-only">{sharedBy}</span>
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`More actions for ${view.name}`}
            className="shrink-0"
          >
            <IconDotsVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isDefault ? (
            <DropdownMenuItem onClick={() => void onClearDefault(view.id)}>
              Clear default
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => void onSetDefault(view.id)}>
              Set as default
            </DropdownMenuItem>
          )}
          {actions.share && (
            <DropdownMenuItem
              onClick={() => void onShare(view.id, !view.shared)}
            >
              {view.shared ? "Unshare" : "Share"}
            </DropdownMenuItem>
          )}
          {actions.delete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onRequestDelete(view)}
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
