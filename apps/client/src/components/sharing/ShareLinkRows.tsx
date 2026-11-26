"use client";

import { convertSharelink, deleteSharelink } from "@/actions/sharelinks";
import CopyButton from "@/components/CopyButton";
import { ShareDialog } from "@/components/sharing/ShareDialog";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useOrigin } from "@/hooks/use-origin";
import { expiryLabel, hasExpired, sharePath } from "@/lib/share-links";
import { pluralizeCount } from "@workspace/session-diff/format";
import { IconDots, IconPlus } from "@tabler/icons-react";
import type { NewShareRequest, Sharelink } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Row,
  RowMain,
  RowMeta,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

const SHARE_TYPE_LABELS: Record<Sharelink["shareType"], string> = {
  connected: "Connected",
  snapshot: "Snapshot",
};

const OTHER_SHARE_TYPE: Record<Sharelink["shareType"], Sharelink["shareType"]> =
  {
    connected: "snapshot",
    snapshot: "connected",
  };

export function ShareLinkRows({
  entityType,
  entityId,
  links,
}: {
  entityType: NewShareRequest["entityType"];
  entityId: number;
  links: Sharelink[];
}) {
  const origin = useOrigin();
  const format = useFormat();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Sharelink | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

  const convert = async (link: Sharelink) => {
    const shareType = OTHER_SHARE_TYPE[link.shareType];
    setConverting(link.token);
    const result = await convertSharelink(link.token, { shareType });
    setConverting(null);

    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(
      shareType === "snapshot"
        ? "Frozen to the versions playing now"
        : "Now follows the current versions"
    );
  };

  const remove = async (link: Sharelink) => {
    const result = await deleteSharelink(link.token);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Share link turned off");
  };
  const deletion = useDeleteGate<Sharelink>("shareLink", remove);

  return (
    <>
      <RailLabel
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-fit"
            aria-label="Share"
            onClick={() => setCreating(true)}
          >
            <IconPlus />
          </Button>
        }
      >
        SHARING
      </RailLabel>

      {links.length === 0 ? (
        <p className="text-small text-ink-soft italic">No links yet</p>
      ) : (
        <Rows>
          {links.map((link) => {
            const expired = hasExpired(link.expiresAt);
            return (
              <Row key={link.token} className="px-0">
                <RowMain>
                  <RowTitle
                    className={cn("text-small", expired && "text-ink-soft")}
                  >
                    {SHARE_TYPE_LABELS[link.shareType]}
                    {link.shareType === "snapshot" &&
                      ` · ${pluralizeCount(link.tracks.length, "track")}`}
                  </RowTitle>
                  <RowMeta className={cn(expired && "text-warn")}>
                    {expiryLabel(link.expiresAt, format)}
                  </RowMeta>
                </RowMain>
                <CopyButton
                  value={`${origin}${sharePath(link.token)}`}
                  label="Copy share link"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Share link actions"
                      disabled={converting === link.token}
                    >
                      <IconDots size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(link)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => convert(link)}>
                      Make {OTHER_SHARE_TYPE[link.shareType]}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => deletion.request(link)}
                    >
                      Turn off
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Row>
            );
          })}
        </Rows>
      )}

      <ShareDialog
        open={creating}
        onOpenChange={setCreating}
        entityType={entityType}
        entityId={entityId}
      />
      {editing && (
        <ShareDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          entityType={entityType}
          entityId={entityId}
          link={editing}
        />
      )}
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title="Turn off this share link?"
        description="It stops working immediately for anyone holding it."
        confirmLabel="Turn off"
      />
    </>
  );
}
