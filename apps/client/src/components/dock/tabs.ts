import type { DockTabId } from "@/lib/policies/shell";
import { routeSegments, type ParsedRoute } from "@/lib/route-parser";
import {
  hrefFromParsedRoute,
  isNotesPath,
  NEW_NOTE_HREF,
  NOTES_HREF,
  PROJECTS_HREF,
} from "@/lib/utils";
import {
  IconDisc,
  IconFileMusic,
  IconHome,
  IconMusic,
  IconNotes,
  IconSearch,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

export type TabContext = {
  /** The route's project, else the `currentProject` cookie. */
  projectId: number | null;
  /** `null` outside `/project/:id` — e.g. on `/notes`. */
  route: ParsedRoute | null;
  pathname: string;
  /** Whether the caller can create collections/tracks in `projectId`. */
  canEdit?: boolean;
};

type TabCommon = {
  id: DockTabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: (ctx: TabContext) => boolean;
};

/**
 * A `"link"` tab navigates — `href` returns `null` when it has nowhere to go
 * right now (a project-scoped tab with no project in context), which
 * `TabBar` reads as "skip this tab". A `"palette"` tab performs an action
 * and never had an `href` to begin with; the discriminant lets `TabBar`
 * dispatch on what a tab *is* instead of reading two meanings into `null`.
 *
 * `longPressHref` is where a finger held on the tab goes instead: the one
 * thing that section is usually opened to do, reached without the page in
 * between.
 */
export type Tab =
  | (TabCommon & {
      kind: "link";
      href: (ctx: TabContext) => string | null;
      longPressHref?: (ctx: TabContext) => string | null;
    })
  | (TabCommon & { kind: "palette" });

/**
 * The first segment a route addresses — `"collection"` for a track viewed
 * inside a collection, which is the tab the breadcrumb agrees with.
 */
const head = (route: ParsedRoute | null): string | undefined =>
  route ? routeSegments(route)[0] : undefined;

/** A project-scoped tab's href: nowhere to go without a project in context. */
const projectHref =
  (route: ParsedRoute) =>
  (ctx: TabContext): string | null =>
    ctx.projectId === null ? null : hrefFromParsedRoute(route, ctx.projectId);

/**
 * Each tab answers where it goes and whether it is the one lit, so the bar
 * itself never branches on route kinds.
 */
export const TABS: Tab[] = [
  {
    id: "home",
    label: "Home",
    icon: IconHome,
    kind: "link",
    href: projectHref({ kind: "project" }),
    longPressHref: () => PROJECTS_HREF,
    isActive: (ctx) => ctx.route?.kind === "project",
  },
  {
    id: "collections",
    label: "Collections",
    icon: IconFileMusic,
    kind: "link",
    href: projectHref({ kind: "collection-all" }),
    longPressHref: (ctx) =>
      ctx.canEdit ? projectHref({ kind: "collection-new" })(ctx) : null,
    isActive: (ctx) => head(ctx.route) === "collection",
  },
  {
    id: "tracks",
    label: "Tracks",
    icon: IconMusic,
    kind: "link",
    href: projectHref({ kind: "track-all" }),
    longPressHref: (ctx) =>
      ctx.canEdit ? projectHref({ kind: "track-new" })(ctx) : null,
    isActive: (ctx) => head(ctx.route) === "track",
  },
  {
    id: "notes",
    label: "Notes",
    icon: IconNotes,
    kind: "link",
    href: () => NOTES_HREF,
    longPressHref: () => NEW_NOTE_HREF,
    isActive: (ctx) => isNotesPath(ctx.pathname),
  },
  {
    id: "search",
    label: "Search",
    icon: IconSearch,
    kind: "palette",
    isActive: () => false,
  },
  {
    id: "studio",
    label: "Studio",
    icon: IconDisc,
    kind: "link",
    href: projectHref({ kind: "session-all" }),
    isActive: (ctx) =>
      head(ctx.route) === "session" ||
      ctx.route?.kind === "plugins" ||
      ctx.route?.kind === "samples",
  },
];

/**
 * The tab bar's tabs, in the order `ids` lists them: an id listed twice shows
 * once, and an id no tab answers to is passed over. The bar shows what it is
 * given, however few.
 */
export function dockTabs(ids: readonly DockTabId[]): Tab[] {
  const byId = new Map(TABS.map((tab) => [tab.id, tab]));
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}
