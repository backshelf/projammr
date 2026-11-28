"use client";

import { TrackForm } from "@/components/forms/TrackForm";
import { TrackPicker } from "@/components/product-linking/pickers";
import { IconPlus } from "@tabler/icons-react";
import type { ActionError, CustomField, Status } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useState } from "react";

/** The collection page's "+": create a track in the collection, or add an existing one. */
export function AddTrackMenu({
  projectId,
  collectionId,
  statusesPromise,
  customFields,
}: {
  projectId: number;
  collectionId: number;
  statusesPromise: Promise<Status[] | ActionError>;
  /** The project's track fields, each an optional row in the create dialog. */
  customFields: readonly CustomField[];
}) {
  const [open, setOpen] = useState<"new" | "existing" | null>(null);

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-fit"
                aria-label="New track"
              >
                <IconPlus />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>New track</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("new")}>
            New track
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("existing")}>
            Existing track
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === "new"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new track</DialogTitle>
            <DialogDescription>
              The track will be linked to this collection.
            </DialogDescription>
          </DialogHeader>
          <TrackForm
            projectId={projectId}
            collectionId={collectionId}
            statusesProm={statusesPromise}
            customFields={customFields}
            onStay={() => setOpen(null)}
            onCancel={() => setOpen(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={open === "existing"}
        onOpenChange={(o) => !o && setOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an existing track</DialogTitle>
            <DialogDescription>
              Link a track that already exists to this collection.
            </DialogDescription>
          </DialogHeader>
          <TrackPicker collectionId={collectionId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
