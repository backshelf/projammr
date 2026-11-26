import { ROUTES, routeDeclaration } from "@/entities/routes";

type ProjectRoot = {
  kind: "project";
};

type Track = {
  kind: "track";
  trackId: number;
  collectionId?: number;
};

type TrackNew = {
  kind: "track-new";
  collectionId?: number;
};

type TrackAll = {
  kind: "track-all";
};

/** The project's archived tracks, which every other track list leaves out. */
type TrackArchived = {
  kind: "track-archived";
};

type Collection = {
  kind: "collection";
  collectionId: number;
};

type CollectionNew = {
  kind: "collection-new";
};

type CollectionAll = {
  kind: "collection-all";
};

type Session = {
  kind: "session";
  sessionId: number;
  trackId?: number;
  collectionId?: number;
};

type SessionNew = {
  kind: "session-new";
  trackId?: number;
  collectionId?: number;
};

type SessionAll = {
  kind: "session-all";
};

/** A session's full save history, with any two saves compared. */
type SessionHistory = {
  kind: "session-history";
  sessionId: number;
  trackId?: number;
  collectionId?: number;
};

type NotFound = {
  kind: "not-found";
};

/** Every device a project's sessions use, across the whole project. */
type Plugins = {
  kind: "plugins";
};

/** Every audio file a project's sessions reference, across the whole project. */
type Samples = {
  kind: "samples";
};

/** A dit repo of the project, with its sets, branches and storage. */
type Repo = {
  kind: "repo";
  repoId: number;
};

export type ParsedRoute =
  | ProjectRoot
  | Track
  | TrackNew
  | TrackAll
  | TrackArchived
  | Collection
  | CollectionNew
  | CollectionAll
  | Session
  | SessionNew
  | SessionAll
  | SessionHistory
  | Plugins
  | Samples
  | Repo
  | NotFound;

export type RouteKind = ParsedRoute["kind"];

/**
 * Total and derived: the first declaration in `ROUTES` whose `match` accepts
 * `segments` wins, and a segment list no declaration accepts is `not-found`.
 * A malformed URL is not found; nothing here redirects.
 */
export const parseRoute = (segments: string[]): ParsedRoute => {
  for (const route of ROUTES) {
    const params = route.match(segments);
    if (params) return { kind: route.kind, ...params } as ParsedRoute;
  }

  return { kind: "not-found" };
};

/**
 * The path under `/project/:projectId` that addresses a route — the inverse of
 * `parseRoute`, and the only place URL shapes are written.
 */
export const routeSegments = (route: ParsedRoute): string[] => {
  if (route.kind === "not-found") return [];

  return routeDeclaration(route.kind).build(route);
};
