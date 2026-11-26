import { describe, expect, it, mock } from "bun:test";

const pathname = { value: "/" };
const cookieProjectId = { value: null as number | null };

/** `useParams`'s view of `pathname.value` under `/project/:id/...` — `useCurrentRoute` reads it, not `usePathname`. */
const paramsFromPath = (
  path: string
): { projectId?: string; route?: string[] } => {
  const match = path.match(/^\/project\/([^/]+)(?:\/(.*))?$/);
  if (!match) return {};
  const [, projectId, rest] = match;
  return { projectId, route: (rest ?? "").split("/").filter(Boolean) };
};

mock.module("next/navigation", () => ({
  usePathname: () => pathname.value,
  useParams: () => paramsFromPath(pathname.value),
}));

mock.module("@/components/dock/CurrentProjectProvider", () => ({
  useCurrentProjectId: () => cookieProjectId.value,
}));

const react = await import("react");
mock.module("react", () => ({
  ...react,
  useMemo: <T>(factory: () => T) => factory(),
}));

// `useMemo` is stubbed above, so the hook is a pure function of the
// pathname and the provided project id, and can be called outside a
// component — the same approach `use-current-route.test.ts` uses.
const { useTabContext: tabContext } = await import("./use-tab-context");

const contextAt = (path: string, cookieId: number | null = null) => {
  pathname.value = path;
  cookieProjectId.value = cookieId;
  return tabContext();
};

describe("useTabContext", () => {
  it("parses the route under a project, ignoring the cookie", () => {
    expect(contextAt("/project/7/collection/3", 99)).toEqual({
      projectId: 7,
      route: { kind: "collection", collectionId: 3 },
      pathname: "/project/7/collection/3",
    });
  });

  it("falls back to the currentProject cookie on /notes", () => {
    expect(contextAt("/notes/12", 7)).toEqual({
      projectId: 7,
      route: null,
      pathname: "/notes/12",
    });
  });

  it("has a null project on /notes with no cookie", () => {
    expect(contextAt("/notes")).toEqual({
      projectId: null,
      route: null,
      pathname: "/notes",
    });
  });

  it("falls back to the currentProject cookie in the settings hub", () => {
    expect(contextAt("/settings/personal/editor", 7)).toEqual({
      projectId: 7,
      route: null,
      pathname: "/settings/personal/editor",
    });
    expect(contextAt("/settings")).toEqual({
      projectId: null,
      route: null,
      pathname: "/settings",
    });
  });

  it("takes the project a hub's Project section names over the cookie", () => {
    expect(contextAt("/settings/project/12/labels", 7)).toEqual({
      projectId: 12,
      route: null,
      pathname: "/settings/project/12/labels",
    });
  });

  it("is null outside /project/:id, /notes and /settings", () => {
    expect(contextAt("/profile")).toBeNull();
    expect(contextAt("/")).toBeNull();
    expect(contextAt("/project/new")).toBeNull();
  });
});
