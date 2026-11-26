/**
 * How the signed-in shell is laid out and how the app answers back.
 * {@link ShellPolicy} arranges the sidebar, the phone's tab bar, the palette's
 * lists and every page's sections, and says what a create form does next;
 * {@link FeedbackPolicy} covers haptics, toasts, which deletes ask first and
 * how long an Undo stays on offer. The defaults are the app as it has always
 * been.
 *
 * A plain module, so a server layout or page imports the defaults and the
 * vocabularies below as values.
 */

import type { PluginOrigin } from "@/lib/plugins-graph";
import type { SamplesShow } from "@/lib/samples-graph";
import type {
  CommandBarMode,
  CommandBarPosition,
} from "@workspace/settings/groups/commands";
import { DELETE_KINDS } from "@workspace/settings/groups/feedback";
import { DOCK_TABS, SIDEBAR_SECTIONS } from "@workspace/settings/groups/layout";
import {
  COLLECTION_PAGE_SECTIONS,
  PROJECT_HOME_SECTIONS,
  SESSION_PAGE_SECTIONS,
  TRACK_PAGE_SECTIONS,
} from "@workspace/settings/groups/pages";
import { PALETTE_EMPTY_GROUPS } from "@workspace/settings/groups/palette";
import type { ToasterProps } from "sonner";

export { DELETE_KINDS };

/** A section of a list the viewer arranges: where it sits, and whether it shows. */
export type PageSection<Id extends string> = { id: Id; shown: boolean };

/**
 * The sections a list shows, in its order. A section named twice shows once,
 * where it first stands.
 */
export function shownSections<S extends PageSection<string>>(
  sections: readonly S[]
): S[] {
  const seen = new Set<string>();
  return sections.filter((section) => {
    if (seen.has(section.id)) return false;
    seen.add(section.id);
    return section.shown;
  });
}

const allShown = <Id extends string>(ids: readonly Id[]): PageSection<Id>[] =>
  ids.map((id) => ({ id, shown: true }));

export type SidebarSectionId = (typeof SIDEBAR_SECTIONS)[number];

export type SidebarSection = PageSection<SidebarSectionId> & {
  /** Whether the section's list is folded away under its heading. */
  collapsed: boolean;
};

/** How the sidebar orders a project's collections. */
export type CollectionOrder =
  /** Newest release first; undated ones after them, by title. */
  | "release"
  /** By title. */
  | "title"
  /** Most recently edited first. */
  | "edited";

export type DockTabId = (typeof DOCK_TABS)[number];

export type PaletteEmptyGroup = (typeof PALETTE_EMPTY_GROUPS)[number];

type ProjectHomeSection = (typeof PROJECT_HOME_SECTIONS)[number];

type CollectionPageSection = (typeof COLLECTION_PAGE_SECTIONS)[number];

type TrackPageSection = (typeof TRACK_PAGE_SECTIONS)[number];

type SessionPageSection = (typeof SESSION_PAGE_SECTIONS)[number];

type EntityPageSections = {
  collection: readonly PageSection<CollectionPageSection>[];
  track: readonly PageSection<TrackPageSection>[];
  session: readonly PageSection<SessionPageSection>[];
};

/** What the plugins and samples pages show when their URL does not say. */
export type InventoryDefaults = {
  plugins: {
    /** Which devices are listed: all of them, or one origin's. */
    origin: "all" | PluginOrigin;
    /** Whether the stock chain is drawn. */
    stock: boolean;
  };
  samples: {
    show: SamplesShow;
    /** Whether Core Library, pack and User Library samples are listed. */
    library: boolean;
    /** Whether the stock chain is drawn. */
    stock: boolean;
  };
};

/** What a create form does once its record exists. */
export type AfterCreate =
  /** Opens the new record's page. */
  | "open"
  /** Goes back to where the form was opened from, with a link to the record. */
  | "stay"
  /** Empties the form for the next one, with a link to the record. */
  | "add-another";

export type ShellPolicy = {
  /** The desktop sidebar's width, in rem. */
  sidebarWidthRem: number;
  /** How many recently edited tracks, sessions and notes the sidebar and
   *  the palette list. */
  recentItems: number;
  /** Whether archived tracks, and the sessions of archived tracks, stay out
   *  of the recently edited lists. */
  recentsSkipArchived: boolean;
  /** The sidebar's sections, in order. */
  sidebarSections: readonly SidebarSection[];
  sidebarCollectionOrder: CollectionOrder;
  /** The phone tab bar's tabs, in order; a tab left out is not shown. */
  dockTabs: readonly DockTabId[];
  /** How many rows a palette prefix command offers at most. A search asks
   *  the server for this many, and the server's own limit caps it. */
  paletteResultCap: number;
  /** Extra words that open a palette prefix command: each word, then the id
   *  of the command it opens. A command's own prefix always wins. */
  paletteAliases: Readonly<Record<string, string>>;
  /** What an empty palette query offers, in order. */
  paletteEmptyGroups: readonly PaletteEmptyGroup[];
  projectHomeSections: readonly PageSection<ProjectHomeSection>[];
  entityPageSections: EntityPageSections;
  inventoryDefaults: InventoryDefaults;
  afterCreate: AfterCreate;
  /** Whether a new comment on the audio that is loaded starts pinned to the
   *  playhead. A comment on audio that is not loaded never does. */
  audioCommentPinned: boolean;
  /** The desktop command bar: whether it shows, where it sits, and when. */
  commandBar: {
    enabled: boolean;
    position: CommandBarPosition;
    mode: CommandBarMode;
  };
};

export const DEFAULT_SHELL: ShellPolicy = {
  sidebarWidthRem: 16,
  recentItems: 5,
  recentsSkipArchived: true,
  sidebarSections: SIDEBAR_SECTIONS.map((id) => ({
    id,
    shown: true,
    collapsed: false,
  })),
  sidebarCollectionOrder: "release",
  dockTabs: DOCK_TABS,
  paletteResultCap: 5,
  paletteAliases: {},
  paletteEmptyGroups: PALETTE_EMPTY_GROUPS,
  projectHomeSections: allShown(PROJECT_HOME_SECTIONS),
  entityPageSections: {
    collection: allShown(COLLECTION_PAGE_SECTIONS),
    track: allShown(TRACK_PAGE_SECTIONS),
    session: allShown(SESSION_PAGE_SECTIONS),
  },
  inventoryDefaults: {
    plugins: { origin: "all", stock: false },
    samples: { show: "all", library: false, stock: false },
  },
  afterCreate: "open",
  audioCommentPinned: true,
  commandBar: { enabled: false, position: "bottom", mode: "always" },
};

export type DeleteKind = (typeof DELETE_KINDS)[number];

type ToastPosition = NonNullable<ToasterProps["position"]>;

export type FeedbackPolicy = {
  /** Whether a press, a tab or a toast buzzes a touch device. */
  haptics: boolean;
  /** How long a toast stays up. */
  toastDurationMs: number;
  toastPosition: ToastPosition;
  /** Whether each kind of delete asks first; a kind switched off deletes at
   *  once. */
  confirmDeletes: Readonly<Record<DeleteKind, boolean>>;
  /** How long a toast offering Undo stays up, and so how long the Undo is on
   *  offer. */
  undoWindowMs: number;
};

export const DEFAULT_FEEDBACK: FeedbackPolicy = {
  haptics: true,
  // Sonner's own defaults, which every toast has always used.
  toastDurationMs: 4000,
  toastPosition: "bottom-right",
  confirmDeletes: Object.fromEntries(
    DELETE_KINDS.map((kind) => [kind, true])
  ) as Record<DeleteKind, boolean>,
  undoWindowMs: 4000,
};

/**
 * Whether a delete of `kind` asks before it runs. The one gate every delete
 * passes: a kind the policy does not name asks, so a kind added later is
 * never deleted unasked by a policy written before it.
 */
export function confirmPolicy(
  kind: DeleteKind,
  feedback: FeedbackPolicy
): boolean {
  return feedback.confirmDeletes[kind] !== false;
}
