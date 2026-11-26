"use client";

import { RelationSelector } from "@/components/product-linking/RelationSelector";
import {
  CollectionPicker,
  SessionPicker,
  TrackPickerForSession,
} from "@/components/product-linking/pickers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Button } from "@workspace/ui/components/button";
import { IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";

type LinkTab = "collection" | "session" | "relation";

type Props = {
  /** The element that opens the dialog. Falls back to a "+" icon button. */
  children?: ReactNode;
} & (
  | {
      targetKind: "track";
      targetId: number;
      defaultTab?: LinkTab;
      /** Collections the track is already in. */
      linkedCollectionIds?: number[];
    }
  | {
      targetKind: "session";
      targetId: number;
      /** The track the session already belongs to. */
      currentTrackId?: number | null;
    }
);

/**
 * The one dialog for linking a record to another: a track to a collection,
 * session or related track; a session to a track. The trigger is whatever
 * the caller renders as `children`, or a "+" icon button when it renders
 * nothing. The trigger element must be built here rather than passed in from a
 * server component: `DialogTrigger` slots its props onto a single child
 * element, and an element serialised across the RSC boundary does not arrive
 * as one.
 */
export function LinkToDialog(props: Props) {
  const { targetId, children } = props;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children ?? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-fit"
            aria-label={
              props.targetKind === "session"
                ? "Assign this session to a track"
                : "Link this track"
            }
          >
            <IconPlus />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {props.targetKind === "session" ? (
          <>
            <DialogHeader>
              <DialogTitle>Assign this session to a track</DialogTitle>
            </DialogHeader>
            <TrackPickerForSession
              sessionId={targetId}
              currentTrackId={props.currentTrackId}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Link this track</DialogTitle>
            </DialogHeader>
            <Tabs defaultValue={props.defaultTab ?? "collection"}>
              <TabsList className="grid grid-cols-3 gap-2">
                <TabsTrigger value="collection">Collection</TabsTrigger>
                <TabsTrigger value="session">Session</TabsTrigger>
                <TabsTrigger value="relation">Relation</TabsTrigger>
              </TabsList>
              <TabsContent value="collection">
                <CollectionPicker
                  trackId={targetId}
                  linkedIds={props.linkedCollectionIds}
                />
              </TabsContent>
              <TabsContent value="session">
                <SessionPicker trackId={targetId} />
              </TabsContent>
              <TabsContent value="relation">
                <RelationSelector trackId={targetId} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
