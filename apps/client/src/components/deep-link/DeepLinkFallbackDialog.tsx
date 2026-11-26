"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { DESKTOP_APP_DOWNLOAD_URL } from "@workspace/ui/lib/site";

/**
 * What a `projammr://` link shows when no app answered. Every link is
 * answered by dit, so the copy names dit for every sender.
 */
export function DeepLinkFallbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projammr desktop app required</DialogTitle>
          <DialogDescription>
            This link needs dit running on this computer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button asChild>
            <a href={DESKTOP_APP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              Download the desktop app
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
