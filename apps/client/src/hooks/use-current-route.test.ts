import { describe, expect, it, mock } from "bun:test";

const params: { projectId?: string; route?: string[] } = {};

mock.module("next/navigation", () => ({
  useParams: () => params,
}));

const react = await import("react");
mock.module("react", () => ({
  ...react,
  useMemo: <T>(factory: () => T) => factory(),
}));

// `useMemo` is stubbed above, so the hook is a pure function of the params
// and can be called outside a component.
const { useCurrentRoute: currentRoute } = await import("./use-current-route");

const routeAt = (projectId: string | undefined, route?: string[]) => {
  params.projectId = projectId;
  params.route = route;
  return currentRoute();
};

describe("useCurrentRoute", () => {
  it("reads the project root", () => {
    expect(routeAt("7")).toEqual({
      projectId: 7,
      route: { kind: "project" },
    });
  });

  it("parses the route under a project", () => {
    expect(routeAt("7", ["collection", "3", "track", "9"])).toEqual({
      projectId: 7,
      route: { kind: "track", collectionId: 3, trackId: 9 },
    });
  });

  it("parses no route for a project's settings, which live in the settings hub", () => {
    expect(routeAt("7", ["settings", "members"])).toEqual({
      projectId: 7,
      route: { kind: "not-found" },
    });
  });

  it("reads no route segments as the project root", () => {
    expect(routeAt("7", [])).toEqual({
      projectId: 7,
      route: { kind: "project" },
    });
  });

  // The hook reads `useParams`, not the pathname, so /project/new, /profile,
  // /notes, /invite/:token and / are one case to it: no projectId segment. The
  // phone chrome widens the /notes case into useTabContext separately.
  it("has no project outside the project tree", () => {
    expect(routeAt(undefined)).toBeNull();
  });

  it("a non-canonical project id is not a project route", () => {
    expect(routeAt("007")).toBeNull();
    expect(routeAt("0")).toBeNull();
    expect(routeAt("abc")).toBeNull();
  });
});
