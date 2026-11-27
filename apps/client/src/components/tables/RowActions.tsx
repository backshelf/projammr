"use client";

import {
  type Icon,
  IconArrowUpRight,
  IconCircleDashed,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconFolderShare,
  IconLayoutSidebarRightExpand,
  IconLibraryPlus,
  IconPencil,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconPlaylistAdd,
  IconTrash,
} from "@tabler/icons-react";
import type { Status } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@workspace/ui/components/context-menu";
import { type ComponentType, type ReactNode, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  type PlaybackSubject,
  usePlayback,
} from "@/components/music-player/use-playback";
import { StatusDisplay } from "@/components/status/StatusDisplay";

/**
 * One of the table kind's declared actions, bound to a target: the row menus
 * and the bulk bar render it after their own open actions and before Move and
 * Delete. `onSelect` resolves once the action has run, which is what the bulk
 * bar holds its busy state across.
 */
export type DeclaredActionItem = {
  id: string;
  label: string;
  icon?: Icon;
  onSelect: () => void | Promise<void>;
};

/**
 * The operations a row offers, in the order they appear. A handler left
 * undefined hides its action, so a table wires up only what it supports.
 * `statuses` arrives already in pipeline order.
 */
export type RowActionsConfig = {
  /** Playback actions offered at the top of the menu for playable rows. */
  playback?: PlaybackSubject;
  /** Statuses offered by "Set status". */
  statuses?: Status[];
  /** Collections offered by "Add to collection". */
  collections?: { id: number; title: string }[];
  onSetStatus?: (statusId: number) => void;
  onAddToCollection?: (collectionId: number) => void;
  /** Open the row in the side panel with its title editor active. */
  onRename?: () => void;
  onCopyLink?: () => void;
  /** Download the row's primary asset, when available. */
  onDownload?: () => void;
  /** Open the row's detail in the side panel (peek). */
  onOpen?: () => void;
  /** Navigate to the row's full page, leaving the table. */
  onOpenPage?: () => void;
  /** The table kind's declared actions this target is offered. */
  actions?: DeclaredActionItem[];
  /** Open the "move to another project" dialog for this row. */
  onMove?: () => void;
  onDelete?: () => void;
};

/**
 * What the actions apply to. A right-click inside a multi-row selection acts on
 * the whole selection, matching the bulk action bar; anywhere else it acts on
 * the row under the cursor alone.
 */
export type RowActionsTarget = {
  count: number;
  /** Plural-aware noun for the menu labels ("3 tracks", "track"). */
  label: string;
};

/**
 * A request, made from outside a row's `⋯` menu, to open it with a submenu
 * open. Each request is its own object: the menu opens once per identity.
 */
export type RowMenuRequest = { rowId: number; submenu: "collection" };

/** A submenu whose open state its host holds. */
type ControlledSub = { open: boolean; onOpenChange: (open: boolean) => void };

/** A status as a menu option: the same chip the table cells use. */
export function StatusOption({ status }: { status: Status }) {
  return <StatusDisplay status={status} variant="chip" />;
}

/**
 * The shapes a host surface has to supply to render the action list. Written
 * structurally rather than as the menu components themselves so a surface that
 * is not a menu — the phone action sheet, whose sub-menus are inline
 * disclosures — can host the same list.
 */
export type ActionPrimitives = {
  Item: ComponentType<{
    onSelect?: (event: Event) => void;
    variant?: "destructive";
    className?: string;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
  Sub: ComponentType<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }>;
  SubTrigger: ComponentType<{ className?: string; children?: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children?: ReactNode }>;
};

/**
 * Playback entries for a playable row, mounted only while a menu is open so
 * resting rows carry no player subscriptions.
 */
function PlaybackMenuItems({
  playback,
  Item,
}: {
  playback: PlaybackSubject;
  Item: ActionPrimitives["Item"];
}) {
  const { playInContext, queueNext, queueLast } = usePlayback(playback);
  const playLabel =
    playback.kind === "collection"
      ? "Play collection"
      : playback.collectionId !== undefined
        ? "Play from here"
        : "Play";
  const queueLabel =
    playback.kind === "collection" ? "Queue collection" : "Add to queue";

  return (
    <>
      <Item onSelect={() => void playInContext()}>
        <IconPlayerPlay />
        {playLabel}
      </Item>
      <Item onSelect={() => void queueNext()}>
        <IconPlayerTrackNext />
        Play next
      </Item>
      <Item onSelect={() => void queueLast()}>
        <IconPlaylistAdd />
        {queueLabel}
      </Item>
    </>
  );
}

/**
 * The action list, rendered with whichever primitives are hosting it. Every
 * surface offers the same operations so the right-click menu, the `⋯` overflow
 * and the phone action sheet never disagree about what a row can do.
 */
export function ActionItems({
  config,
  target,
  primitives,
  collectionSub,
}: {
  config: RowActionsConfig;
  target: RowActionsTarget;
  primitives: ActionPrimitives;
  /** Holds the "Add to collection" submenu's open state, when the host does. */
  collectionSub?: ControlledSub;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = primitives;
  const { playback, statuses, collections, onSetStatus, onAddToCollection } =
    config;
  const {
    onRename,
    onCopyLink,
    onDownload,
    onOpen,
    onOpenPage,
    onMove,
    onDelete,
  } = config;
  const { actions } = config;

  // A bulk target has no single row to play, open, rename or link to.
  const single = target.count === 1;
  const hasPlayback = Boolean(playback && single);
  const hasStatus = Boolean(onSetStatus && statuses && statuses.length > 0);
  const hasCollections = Boolean(
    onAddToCollection && collections && collections.length > 0
  );
  const hasMiddle = Boolean(
    (onOpen && single) ||
    (onOpenPage && single) ||
    hasStatus ||
    hasCollections ||
    (onRename && single) ||
    (onCopyLink && single) ||
    (onDownload && single) ||
    (actions && actions.length > 0)
  );
  const hasBottom = Boolean(onMove || onDelete);

  return (
    <>
      {hasPlayback && playback && (
        <PlaybackMenuItems playback={playback} Item={Item} />
      )}
      {hasPlayback && hasMiddle && <Separator />}
      {onOpen && single && (
        <Item onSelect={() => onOpen()}>
          <IconLayoutSidebarRightExpand />
          Open
        </Item>
      )}
      {onOpenPage && single && (
        <Item onSelect={() => onOpenPage()}>
          <IconArrowUpRight />
          Open page
        </Item>
      )}
      {hasStatus && onSetStatus && statuses && (
        <Sub>
          <SubTrigger>
            <IconCircleDashed />
            Set status
          </SubTrigger>
          <SubContent>
            {statuses.map((status) => (
              <Item key={status.id} onSelect={() => onSetStatus(status.id)}>
                <StatusOption status={status} />
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {hasCollections && onAddToCollection && collections && (
        <Sub
          open={collectionSub?.open}
          onOpenChange={collectionSub?.onOpenChange}
        >
          <SubTrigger>
            <IconLibraryPlus />
            Add to collection
          </SubTrigger>
          <SubContent className="max-h-72 overflow-y-auto">
            {collections.map((collection) => (
              <Item
                key={collection.id}
                onSelect={() => onAddToCollection(collection.id)}
              >
                {collection.title}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {onRename && single && (
        <Item onSelect={() => onRename()}>
          <IconPencil />
          Rename
        </Item>
      )}
      {onCopyLink && single && (
        <Item onSelect={() => onCopyLink()}>
          <IconCopy />
          Copy link
        </Item>
      )}
      {onDownload && single && (
        <Item onSelect={() => onDownload()}>
          <IconDownload />
          Download
        </Item>
      )}
      {actions?.map(({ id, label, icon: ActionIcon, onSelect }) => (
        <Item key={id} onSelect={() => void onSelect()}>
          {ActionIcon && <ActionIcon />}
          {label}
        </Item>
      ))}
      {(hasPlayback || hasMiddle) && hasBottom && <Separator />}
      {onMove && (
        <Item onSelect={() => onMove()}>
          <IconFolderShare />
          Move to project…
        </Item>
      )}
      {onDelete && (
        <Item variant="destructive" onSelect={() => onDelete()}>
          <IconTrash />
          {single ? "Delete" : `Delete ${target.count} ${target.label}`}
        </Item>
      )}
    </>
  );
}

/** The action list for a right-click menu. */
export function RowContextMenuItems({
  config,
  target,
}: {
  config: RowActionsConfig;
  target: RowActionsTarget;
}) {
  return (
    <ActionItems
      config={config}
      target={target}
      primitives={{
        Item: ContextMenuItem,
        Separator: ContextMenuSeparator,
        Sub: ContextMenuSub,
        SubTrigger: ContextMenuSubTrigger,
        SubContent: ContextMenuSubContent,
      }}
    />
  );
}

/**
 * The per-row action bar.
 *
 * Lives in a cell pinned to the viewport's right edge, because the grid is
 * routinely wider than the window and a trailing column would otherwise sit
 * off-screen exactly when it is wanted. The buttons are transparent until the
 * row is hovered or something inside them takes focus, so a resting table stays
 * quiet — but they remain in the tab order at all times, which is what keeps
 * these actions reachable without a mouse.
 */
export function RowActionsBar({
  config,
  target,
  entityLabel,
  menuRequest = null,
  onMenuClose,
}: {
  config: RowActionsConfig;
  target: RowActionsTarget;
  entityLabel: string;
  /** Opens the `⋯` menu with a submenu open, once per request. */
  menuRequest?: RowMenuRequest | null;
  /** Called when the `⋯` menu closes, so its host can drop the request. */
  onMenuClose?: () => void;
}) {
  // Delete is reachable only from the `⋯` menu and the right-click menu: it is
  // the one irreversible action here, and it should not sit under a cursor that
  // is already moving across hover targets.
  const { statuses, onSetStatus, onCopyLink, onOpen } = config;

  // The menu is held here so a request can open it; a click opens and closes
  // it exactly as an uncontrolled menu does.
  const [menuOpen, setMenuOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [handledRequest, setHandledRequest] = useState(menuRequest);
  if (menuRequest !== handledRequest) {
    setHandledRequest(menuRequest);
    if (menuRequest) {
      setMenuOpen(true);
      setCollectionOpen(menuRequest.submenu === "collection");
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {/* Hover-only quick buttons stay hidden on non-fine pointers so touch
          devices and headless renders show only the single `⋮` trigger rather
          than a wide always-on action slab over the trailing column. */}
      <div className="hidden items-center gap-0.5 fine:flex">
        {onSetStatus && statuses && statuses.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Set status of ${entityLabel}`}
              >
                <IconCircleDashed />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {statuses.map((status) => (
                <DropdownMenuItem
                  key={status.id}
                  onSelect={() => onSetStatus(status.id)}
                >
                  <StatusOption status={status} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onOpen && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Open ${entityLabel}`}
            onClick={onOpen}
          >
            <IconLayoutSidebarRightExpand />
          </Button>
        )}

        {onCopyLink && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy link to ${entityLabel}`}
            onClick={onCopyLink}
          >
            <IconCopy />
          </Button>
        )}
      </div>

      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) {
            setCollectionOpen(false);
            onMenuClose?.();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`More actions for ${entityLabel}`}
          >
            <IconDotsVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ActionItems
            config={config}
            target={target}
            collectionSub={{
              open: collectionOpen,
              onOpenChange: setCollectionOpen,
            }}
            primitives={{
              Item: DropdownMenuItem,
              Separator: DropdownMenuSeparator,
              Sub: DropdownMenuSub,
              SubTrigger: DropdownMenuSubTrigger,
              SubContent: DropdownMenuSubContent,
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
