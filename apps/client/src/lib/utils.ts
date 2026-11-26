import { routeSegments, type ParsedRoute } from "./route-parser";
import { entityModule } from "@/entities";
import type { RouteParents } from "@/entities/types";
import { Collection, Project, Session, Track } from "@workspace/api/api";

/** The one route outside a project's own tree. */
export const NEW_PROJECT_HREF = "/project/new";

/** The list of the signed-in user's projects. */
export const PROJECTS_HREF = "/projects";

/** The signed-in user's notebook — notes are not scoped to a project. */
export const NOTES_HREF = "/notes";
export const NEW_NOTE_HREF = "/notes/new";
export const noteHref = (id: number): string => `/notes/${id}`;

/** Whether a pathname addresses the notebook, rather than merely starting like it. */
export const isNotesPath = (pathname: string): boolean =>
  pathname === NOTES_HREF || pathname.startsWith(`${NOTES_HREF}/`);

/**
 * The note a pathname opens, read from the URL rather than the route tree:
 * a draft's first save rewrites the address to the note's own URL without a
 * navigation, so the route segment still says `new` while the pathname does
 * not. `null` on `/notes`, `/notes/new` and anything outside the notebook.
 */
export const noteIdFromPath = (pathname: string): number | null => {
  const match = /^\/notes\/(\d+)$/.exec(pathname);
  return match ? Number(match[1]) : null;
};

/**
 * What to call a note. A note takes its title from its first line, so one
 * nobody has typed into yet has none, and every surface that lists notes
 * needs the same word for it.
 */
export const noteTitle = (title: string): string => title || "New note";

/** Whether a note answers a search, by its title or the opening of its text. */
export const noteMatches = (
  note: { title: string; preview: string },
  query: string
): boolean => {
  const q = query.toLowerCase();
  return (
    note.title.toLowerCase().includes(q) ||
    note.preview.toLowerCase().includes(q)
  );
};

export const hrefFromParsedRoute = (
  route: ParsedRoute,
  projectId: number
): string => [`/project/${projectId}`, ...routeSegments(route)].join("/");

/** One entry in a breadcrumb trail: the label it shows, and the page it links to. */
export type Crumb = { label: string; href: string };

/**
 * The breadcrumb trail for a project entity's own page: the project, then
 * whichever of collection, track and session it was reached through, each
 * linking to that entity's own page rather than to whichever page happens to
 * sit at that point in the URL. A track shown alongside a collection keeps
 * the collection in its href — the same URL the collection page's own track
 * links use — and a session shown alongside a track keeps the track (and
 * collection) in its href the same way.
 */
export const createBreadcrumbs = (
  project: Pick<Project, "id" | "name">,
  {
    collection,
    track,
    session,
  }: {
    collection?: Pick<Collection, "id" | "title">;
    track?: Pick<Track, "id" | "title">;
    session?: Pick<Session, "id" | "name">;
  } = {}
): Crumb[] => {
  const projectId = project.id;
  const projectModule = entityModule("project");
  const crumbs: Crumb[] = [
    {
      label: projectModule.labelOf(project),
      href: hrefFromParsedRoute(
        projectModule.pageRoute(project.id, {}),
        projectId
      ),
    },
  ];

  const parents: RouteParents = {};
  const rows: [
    ["collection", Pick<Collection, "id" | "title"> | undefined],
    ["track", Pick<Track, "id" | "title"> | undefined],
    ["session", Pick<Session, "id" | "name"> | undefined],
  ] = [
    ["collection", collection],
    ["track", track],
    ["session", session],
  ];

  for (const [kind, row] of rows) {
    if (!row) continue;
    const entity = entityModule(kind);
    crumbs.push({
      label: entity.labelOf(row),
      href: hrefFromParsedRoute(entity.pageRoute(row.id, parents), projectId),
    });
    if (kind === "collection") parents.collectionId = row.id;
    if (kind === "track") parents.trackId = row.id;
  }

  return crumbs;
};

/**
 * A name's initials for an avatar fallback: "Chris Doe" becomes "CD". Joined
 * with no separator, so a screen reader reads one word rather than a
 * comma-spliced list of letters, and capped at the two an avatar fits.
 */
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2);

/**
 * A same-origin URL for an uploaded file, routed through the `/media` proxy so
 * the session cookie authenticates the request (see `app/media/[...path]`).
 * Accepts any of the shapes the API hands back — `./static/images/foo.png`,
 * `/static/images/foo.png`, or a bare `images/foo.png` — and an empty/nullish
 * value passes through so callers can use it unconditionally.
 *
 * A `/share/` path passes through too: a share link's own routes are what
 * authenticate a guest's request for the bytes, so they must not be rewritten
 * onto the membership-gated proxy.
 */
export const mediaProxyUrl = (storedPath: string | null | undefined) => {
  if (!storedPath) return "";
  if (/^(https?:|data:|blob:|\/media\/|\/share\/)/.test(storedPath)) {
    return storedPath;
  }
  return `/media/${storedPath.replace(/^\.?\/?(static\/)?/, "")}`;
};

/**
 * The widths the API serves resized copies of a stored image at. Any other
 * width is refused, so a caller asks for the smallest one that still covers
 * what it renders at two device pixels.
 */
export const IMAGE_WIDTHS = [64, 256, 1024] as const;

export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * A stored image's URL, at one of the served widths when the caller knows how
 * big it draws. The variant is a WebP resize the API caches and never
 * upscales, so an image already smaller than `width` arrives untouched.
 */
export const imageUrl = (
  storedPath: string | null | undefined,
  width?: ImageWidth
) => {
  const url = mediaProxyUrl(storedPath);
  if (!url || width === undefined || /^(https?:|data:|blob:)/.test(url)) {
    return url;
  }
  return `${url}?w=${width}`;
};

/** As `mediaProxyUrl`, but asks the API to send the file as an attachment. */
export const mediaDownloadUrl = (storedPath: string | null | undefined) => {
  const url = mediaProxyUrl(storedPath);
  if (!url || url.startsWith("http") || url.startsWith("data:")) return url;
  return `${url}?download`;
};

export const collectionSorter = (
  a: Pick<Collection, "title" | "releaseDate">,
  b: Pick<Collection, "title" | "releaseDate">
) => {
  const aHasDate = !!a.releaseDate;
  const bHasDate = !!b.releaseDate;
  if (aHasDate && bHasDate) {
    return (
      new Date(b.releaseDate!).getTime() - new Date(a.releaseDate!).getTime()
    );
  }
  if (aHasDate && !bHasDate) {
    return -1;
  }
  if (!aHasDate && bHasDate) {
    return 1;
  }
  return a.title.localeCompare(b.title);
};
