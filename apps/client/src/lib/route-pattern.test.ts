import { describe, expect, it } from "bun:test";
import { collectionRoutes } from "@/entities/collection/routes";
import { projectRoutes } from "@/entities/project/routes";
import { sessionRoutes } from "@/entities/session/routes";
import { trackRoutes } from "@/entities/track/routes";
import { parseId, type RouteDeclaration } from "./route-pattern";

const ALL_ROUTES: readonly RouteDeclaration[] = [
  ...projectRoutes,
  ...collectionRoutes,
  ...trackRoutes,
  ...sessionRoutes,
];

const matchingRoutes = (segments: readonly string[]) =>
  ALL_ROUTES.filter((route) => route.match(segments) !== null);

/** The 18 URL shapes `route-parser.test.ts` round-trips today, plus two multi-parent shapes. */
const VALID_PATHS = [
  "track/12",
  "collection/3/track/12",
  "collection/3",
  "collection/3/track/12/session/7",
  "session/7",
  "track/new",
  "collection/3/track/new",
  "track/all",
  "collection/new",
  "collection/all",
  "session/new",
  "session/all",
  "plugins",
  "samples",
  "repo/5",
  "session/7/history",
  "collection/3/track/12/session/7/history",
  "collection/3/session/7",
  "track/12/session/7",
];

/** Segment lists no declaration should match: bad ids, wrong order, or a shape no route declares. */
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
  ["settings", "garbage"],
  ["session", "7", "plugins"],
  ["samples", "extra"],
  ["session", "7", "samples"],
  ["collection", "3", "track", "all"],
  ["repo"],
  ["repo", "abc"],
  ["repo", "5", "extra"],
];

describe("route declarations", () => {
  it("matches the project root to exactly one declaration", () => {
    expect(matchingRoutes([])).toHaveLength(1);
  });

  it.each(VALID_PATHS)("matches %s to exactly one declaration", (path) => {
    expect(matchingRoutes(path.split("/"))).toHaveLength(1);
  });

  it.each(VALID_PATHS)("build is the inverse of match for %s", (path) => {
    const segments = path.split("/");
    const [route] = matchingRoutes(segments);
    const params = route?.match(segments);
    expect(route?.build({ kind: route.kind, ...params } as never)).toEqual(
      segments
    );
  });

  it.each(MALFORMED_SEGMENTS)("rejects %j", (...segments) => {
    expect(matchingRoutes(segments)).toHaveLength(0);
  });

  it("has exactly one declaration per kind", () => {
    const kinds = ALL_ROUTES.map((route) => route.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("parseId", () => {
  it.each(["1", "9", "12", "1000000000"])(
    "accepts the canonical positive integer %s",
    (segment) => {
      expect(parseId(segment)).toBe(Number(segment));
    }
  );

  it.each([
    undefined,
    "",
    "0",
    "007",
    "-5",
    "1.5",
    "1e3",
    " 12",
    "Infinity",
    "abc",
    "99999999999999999999",
  ])("rejects %j", (segment) => {
    expect(parseId(segment)).toBeNull();
  });
});
