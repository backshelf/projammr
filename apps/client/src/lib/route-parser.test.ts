import { describe, expect, it } from "bun:test";
import { parseRoute, routeSegments, type ParsedRoute } from "./route-parser";

const roundTrip = (path: string) => routeSegments(parseRoute(path.split("/")));

/** One route object of every kind `ParsedRoute` declares, project root included. */
const ONE_OF_EVERY_KIND: readonly ParsedRoute[] = [
  { kind: "project" },
  { kind: "track", trackId: 12 },
  { kind: "track-new" },
  { kind: "track-all" },
  { kind: "track-archived" },
  { kind: "collection", collectionId: 3 },
  { kind: "collection-new" },
  { kind: "collection-all" },
  { kind: "session", sessionId: 7 },
  { kind: "session-new" },
  { kind: "session-all" },
  { kind: "session-history", sessionId: 7 },
  { kind: "plugins" },
  { kind: "samples" },
  { kind: "repo", repoId: 5 },
];

/** Segment lists no declaration matches: bad ids, wrong order, or a shape no route declares. */
const MALFORMED_SEGMENTS: readonly string[][] = [
  ["track", "007"],
  ["track", "1e3"],
  ["track", "-5"],
  ["track", "0"],
  ["track", "1.5"],
  ["track", " 12"],
  ["track", "Infinity"],
  ["track", "99999999999999999999"],
  ["collection", "abc", "track", "12"],
  ["track", "12", "collection", "3"],
  ["collection", "all", "track", "12"],
  ["track", "12", "track", "13"],
  ["collection", "2", "settings"],
  ["settings"],
  ["settings", "labels"],
  ["settings", "garbage"],
  ["session", "7", "plugins"],
  ["samples", "extra"],
  ["session", "7", "samples"],
  ["collection", "3", "track", "all"],
  ["repo"],
  ["repo", "0"],
  ["repo", "5", "extra"],
  ["session", "7", "repo", "5"],
];

describe("routeSegments", () => {
  it.each([
    "track/12",
    "collection/3/track/12",
    "collection/3",
    "collection/3/track/12/session/7",
    "session/7",
    "track/new",
    "collection/3/track/new",
    "track/all",
    "track/archived",
    "collection/new",
    "collection/all",
    "session/new",
    "session/all",
    "plugins",
    "samples",
    "repo/5",
    "session/7/history",
    "collection/3/track/12/session/7/history",
  ])("round-trips /%s", (path) => {
    expect(roundTrip(path).join("/")).toBe(path);
  });

  it("parses a session's history with no parent track or collection", () => {
    expect(parseRoute(["session", "7", "history"])).toEqual({
      kind: "session-history",
      sessionId: 7,
      trackId: undefined,
      collectionId: undefined,
    });
  });

  it("parses a session's history with a parent track and collection", () => {
    expect(
      parseRoute(["collection", "3", "track", "12", "session", "7", "history"])
    ).toEqual({
      kind: "session-history",
      sessionId: 7,
      trackId: 12,
      collectionId: 3,
    });
  });

  it("addresses the project root with no segments", () => {
    expect(routeSegments({ kind: "project" })).toEqual([]);
  });

  it("has nothing to address for an unknown route", () => {
    expect(routeSegments({ kind: "not-found" })).toEqual([]);
  });

  it("keeps the parent collection of a new session", () => {
    const route: ParsedRoute = { kind: "session-new", collectionId: 3 };
    expect(routeSegments(route)).toEqual(["collection", "3", "session", "new"]);
  });
});

describe("parseRoute", () => {
  it.each(MALFORMED_SEGMENTS)("parses %j as not-found", (...segments) => {
    expect(parseRoute(segments)).toEqual({ kind: "not-found" });
  });

  it("new and all routes carry no id", () => {
    expect(Object.keys(parseRoute(["track", "new"]))).toEqual(["kind"]);
  });

  it("reads track/archived as the archived list, never as a track id", () => {
    expect(parseRoute(["track", "archived"])).toEqual({
      kind: "track-archived",
    });
    expect(parseRoute(["track", "12"])).toEqual({
      kind: "track",
      trackId: 12,
      collectionId: undefined,
    });
  });

  // Copied because `it.each` takes a mutable array.
  it.each([...ONE_OF_EVERY_KIND])("round-trips %j in reverse", (route) => {
    expect(parseRoute(routeSegments(route))).toEqual(route);
  });
});
