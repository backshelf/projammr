import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  PluginSession,
  PluginUsage,
  SessionSummary,
} from "@workspace/api/api";

const replace = mock();
let currentQuery = "";
mock.module("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/project/7/plugins",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const { InventoryPage } = await import("./InventoryPage");
const { PluginRows } = await import("./PluginRows");
const { pluginsGraph } = await import("@/lib/plugins-graph");
const { DEFAULT_SHELL } = await import("@/lib/policies/shell");

const DEFAULTS = DEFAULT_SHELL.inventoryDefaults.plugins;

const session = (id: number, name: string): SessionSummary => ({
  id,
  name,
  daw: "ableton",
  trackId: null,
  main: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
});

const device = (
  name: string,
  sessionIds: number[],
  extra: Partial<PluginUsage> = {}
): PluginUsage => ({
  name,
  sessions: sessionIds.length,
  tracks: sessionIds.length + 1,
  sessionIds,
  sessionTracks: sessionIds.map((_, i) => (i === 0 ? 2 : 1)),
  origin: "builtin",
  ...extra,
});

const SESSIONS = [session(1, "Invented Set A"), session(2, "Invented Set B")];
const USAGE = [
  device("Wobbleforge", [1, 2], {
    origin: "plugin",
    host: "vst3",
    manufacturer: "Nimbus Audio",
  }),
  device("Glasshall Verb", [1], { origin: "plugin", host: "au" }),
  device("Compressor", [1, 2]),
];

const PLUGIN_SESSIONS: PluginSession[] = [
  {
    id: 1,
    name: "Invented Set A",
    daw: "ableton",
    updatedAt: "2026-09-01T00:00:00.000Z",
    trackId: 3,
    trackTitle: "Invented Track",
    onTracks: ["Pad", "Lead"],
  },
];

const ORIGIN_TABS = [
  { value: "all", label: "All" },
  { value: "plugin", label: "Plugins" },
  { value: "builtin", label: "Built-in" },
];

const renderPage = ({
  plugins = USAGE,
  origin,
  stock,
  expanded,
  emptyLine = "Nothing here.",
}: {
  plugins?: PluginUsage[];
  origin?: "plugin" | "builtin";
  stock?: boolean;
  expanded?: { device: string; sessions: PluginSession[] };
  emptyLine?: string;
} = {}) => {
  const graph = pluginsGraph(plugins, SESSIONS, {
    projectId: 7,
    origin,
    stock,
    defaults: DEFAULTS,
  });
  return render(
    <InventoryPage
      crumbs={null}
      title="Plugins"
      lede="3 devices across 2 sets · 2 third-party"
      filters={{
        tabs: {
          param: "origin",
          active: origin ?? "all",
          fallback: DEFAULTS.origin,
          items: ORIGIN_TABS,
        },
        searchPlaceholder: "Search devices",
        expandParam: "device",
      }}
      rows={
        <PluginRows
          projectId={7}
          plugins={graph.plugins}
          origin={origin}
          stock={stock}
          emptyLine={emptyLine}
          expanded={expanded}
        />
      }
    />
  );
};

/** The page's links: the device rows and an open row's sessions (the web
 *  streams in on its own and is not rendered here). */
const rowLinks = () => screen.queryAllByRole("link");

const rowLabels = () =>
  rowLinks()
    .filter((link) => link.getAttribute("href")?.includes("device="))
    .map((link) => link.textContent);

const search = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search devices"), {
    target: { value },
  });

beforeEach(() => {
  replace.mockReset();
  currentQuery = "";
});

describe("plugins page head", () => {
  test("renders the title, the lede and the three origin tabs, without a Library toggle", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Plugins" })).not.toBeNull();
    expect(
      screen.getAllByText("3 devices across 2 sets · 2 third-party").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Plugins" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Built-in" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Library" })).toBeNull();
  });

  test("a tab writes ?origin= and drops the open device", () => {
    currentQuery = "device=Compressor";
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Built-in" }));

    expect(replace).toHaveBeenCalledWith("/project/7/plugins?origin=builtin", {
      scroll: false,
    });
  });

  test("the All tab leaves origin out of the URL", () => {
    currentQuery = "origin=plugin";
    renderPage({ origin: "plugin" });

    fireEvent.click(screen.getByRole("tab", { name: "All" }));

    expect(replace).toHaveBeenCalledWith("/project/7/plugins", {
      scroll: false,
    });
  });
});

describe("PluginRows", () => {
  test("lists every device on the All tab, with its origin line and counts", () => {
    renderPage();

    expect(rowLabels()).toEqual([
      expect.stringContaining("Wobbleforge"),
      expect.stringContaining("Glasshall Verb"),
      expect.stringContaining("Compressor"),
    ]);
    expect(screen.getAllByText("Nimbus Audio · VST3").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByText("2 sets")).toHaveLength(2);
    expect(screen.getByText("1 set")).not.toBeNull();
    expect(screen.getAllByText("3 tracks")).toHaveLength(2);
    expect(screen.getByText("2 tracks")).not.toBeNull();
    expect(screen.getAllByText("Built-in").length).toBeGreaterThan(0);
  });

  test("keeps only the tab's devices in the rows", () => {
    renderPage({ origin: "builtin" });

    expect(rowLabels()).toEqual([expect.stringContaining("Compressor")]);
  });

  test("filters the rows by name and by manufacturer", () => {
    renderPage();

    search("glass");
    expect(rowLabels()).toEqual([expect.stringContaining("Glasshall Verb")]);

    search("nimbus");
    expect(rowLabels()).toEqual([expect.stringContaining("Wobbleforge")]);
  });

  test("says so when nothing matches", () => {
    renderPage();

    search("zzz");

    expect(screen.getByText("No devices match.")).not.toBeNull();
  });

  test("opens the row its param names and lists its sessions as session links", () => {
    renderPage({
      expanded: { device: "Compressor", sessions: PLUGIN_SESSIONS },
    });

    const open = rowLinks().find(
      (link) => link.getAttribute("aria-current") === "true"
    );
    expect(open?.textContent).toContain("Compressor");
    expect(open?.getAttribute("href")).toBe("/project/7/plugins");
    const set = rowLinks().find((link) =>
      link.textContent?.includes("Invented Set A")
    );
    expect(set?.getAttribute("href")).toBe("/project/7/track/3/session/1");
    expect(screen.getByText("on Pad, Lead · Invented Track")).not.toBeNull();
  });

  test("a closed row links to itself open, keeping the tab", () => {
    renderPage({ origin: "plugin" });

    const row = rowLinks().find((link) =>
      link.textContent?.includes("Glasshall Verb")
    );
    expect(row?.getAttribute("href")).toBe(
      "/project/7/plugins?origin=plugin&device=Glasshall+Verb"
    );
  });

  test("a row keeps the stock chain drawn, open or closed", () => {
    renderPage({
      stock: true,
      expanded: { device: "Compressor", sessions: PLUGIN_SESSIONS },
    });

    const hrefOf = (name: string) =>
      rowLinks()
        .find((link) => link.textContent?.includes(name))
        ?.getAttribute("href");
    expect(hrefOf("Glasshall Verb")).toBe(
      "/project/7/plugins?stock=1&device=Glasshall+Verb"
    );
    expect(hrefOf("Compressor")).toBe("/project/7/plugins?stock=1");
  });

  test("a param naming no device expands nothing", () => {
    renderPage({ expanded: { device: "Gone", sessions: PLUGIN_SESSIONS } });

    expect(
      rowLinks().filter((link) => link.getAttribute("aria-current") === "true")
    ).toHaveLength(0);
  });

  test("says no session carries a device the server found none for", () => {
    renderPage({ expanded: { device: "Compressor", sessions: [] } });

    expect(screen.getByText("No sessions carry this device.")).not.toBeNull();
  });

  test("shows the empty line when there is no device to list", () => {
    renderPage({ plugins: [], emptyLine: "No devices yet." });

    expect(screen.getByText("No devices yet.")).not.toBeNull();
  });
});
