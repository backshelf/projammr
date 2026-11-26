import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  SampleSession,
  SampleUsage,
  SessionSummary,
} from "@workspace/api/api";

const replace = mock();
let currentQuery = "";
mock.module("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/project/7/samples",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const { InventoryPage } = await import("./InventoryPage");
const { SampleRows } = await import("./SampleRows");
const { samplesGraph } = await import("@/lib/samples-graph");
const { DEFAULT_SHELL } = await import("@/lib/policies/shell");

const DEFAULTS = DEFAULT_SHELL.inventoryDefaults.samples;

const session = (id: number, name: string): SessionSummary => ({
  id,
  name,
  daw: "ableton",
  trackId: null,
  main: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
});

const usage = (
  path: string,
  sessionIds: number[],
  extra: Partial<SampleUsage> = {}
): SampleUsage => ({
  path,
  kind: "project",
  sessions: sessionIds.length,
  sessionIds,
  missing: false,
  ...extra,
});

const SESSIONS = [session(1, "Invented Set A"), session(2, "Invented Set B")];
const USAGE = [
  usage("/Users/demo/Samples/Shared Kick.wav", [1, 2]),
  usage("/Users/demo/Samples/Shared Snare.wav", [1, 2]),
  usage("/Users/demo/Loops/Lost Hat.wav", [1, 2], { missing: true }),
];

const KICK = "/Users/demo/Samples/Shared Kick.wav";

const SAMPLE_SESSIONS: SampleSession[] = [
  {
    id: 1,
    name: "Invented Set A",
    daw: "ableton",
    updatedAt: "2026-09-01T00:00:00.000Z",
    trackId: 3,
    trackTitle: "Invented Track",
    status: "present",
  },
];

const renderPage = ({
  samples = USAGE,
  show = "all",
  library = false,
  stock = false,
  expanded,
  emptyLine = "Nothing here.",
}: {
  samples?: SampleUsage[];
  show?: "all" | "missing";
  library?: boolean;
  stock?: boolean;
  expanded?: { path: string; sessions: SampleSession[] };
  emptyLine?: string;
} = {}) => {
  const graph = samplesGraph(samples, SESSIONS, {
    projectId: 7,
    show,
    library,
    stock,
    defaults: DEFAULTS,
  });
  return render(
    <InventoryPage
      crumbs={null}
      title="Samples"
      lede="3 samples across 2 sets"
      filters={{
        tabs: {
          param: "show",
          active: show,
          fallback: DEFAULTS.show,
          items: [
            { value: "all", label: "All" },
            { value: "missing", label: "Missing" },
          ],
        },
        searchPlaceholder: "Search samples",
        library: {
          param: "library",
          on: library,
          fallback: DEFAULTS.library,
          label: "Library",
        },
        expandParam: "sample",
      }}
      rows={
        <SampleRows
          projectId={7}
          samples={graph.samples}
          view={{ show, library, stock }}
          emptyLine={emptyLine}
          expanded={expanded}
        />
      }
    />
  );
};

/** The page's links: the sample rows and an open row's sets (the web
 *  streams in on its own and is not rendered here). */
const rowLinks = () => screen.queryAllByRole("link");

const rowLabels = () =>
  rowLinks()
    .filter((link) => link.getAttribute("href")?.includes("sample="))
    .map((link) => link.textContent);

const search = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search samples"), {
    target: { value },
  });

beforeEach(() => {
  replace.mockReset();
  currentQuery = "";
});

describe("InventoryPage head", () => {
  test("renders the title, the lede, the tabs and the Library toggle", () => {
    renderPage();

    const selected = (role: string, name: string, attribute: string) =>
      screen.getByRole(role, { name }).getAttribute(attribute);

    expect(screen.getByRole("heading", { name: "Samples" })).not.toBeNull();
    expect(
      screen.getAllByText("3 samples across 2 sets").length
    ).toBeGreaterThan(0);
    expect(selected("tab", "All", "aria-selected")).toBe("true");
    expect(selected("tab", "Missing", "aria-selected")).toBe("false");
    expect(selected("button", "Library", "aria-pressed")).toBe("false");
  });

  test("a tab writes its param and drops the open row", () => {
    currentQuery = "sample=x&library=1";
    renderPage({ library: true });

    fireEvent.click(screen.getByRole("tab", { name: "Missing" }));

    expect(replace).toHaveBeenCalledWith(
      "/project/7/samples?library=1&show=missing",
      { scroll: false }
    );
  });

  test("the first tab leaves its param out of the URL", () => {
    currentQuery = "show=missing";
    renderPage({ show: "missing" });

    fireEvent.click(screen.getByRole("tab", { name: "All" }));

    expect(replace).toHaveBeenCalledWith("/project/7/samples", {
      scroll: false,
    });
  });

  test("the Library toggle writes library=1 when turned on, and clears it when turned off", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(replace).toHaveBeenLastCalledWith("/project/7/samples?library=1", {
      scroll: false,
    });

    currentQuery = "library=1&sample=x";
    renderPage({ library: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Library" })[1]!);
    expect(replace).toHaveBeenLastCalledWith("/project/7/samples", {
      scroll: false,
    });
  });
});

describe("InventoryPage search", () => {
  test("filters the rows by filename and by folder", () => {
    renderPage();
    expect(rowLabels()).toHaveLength(3);

    search("kick");
    expect(rowLabels()).toEqual([expect.stringContaining("Shared Kick.wav")]);

    search("loops");
    expect(rowLabels()).toEqual([expect.stringContaining("Lost Hat.wav")]);
  });

  test("says so when nothing matches", () => {
    renderPage();

    search("zzz");

    expect(screen.getByText("No samples match.")).not.toBeNull();
  });
});

describe("SampleRows", () => {
  test("opens the row its param names and lists its sets as session links", () => {
    renderPage({ expanded: { path: KICK, sessions: SAMPLE_SESSIONS } });

    const open = rowLinks().find(
      (link) => link.getAttribute("aria-current") === "true"
    );
    expect(open?.textContent).toContain("Shared Kick.wav");
    expect(open?.getAttribute("href")).toBe("/project/7/samples");
    const set = rowLinks().find((link) =>
      link.textContent?.includes("Invented Set A")
    );
    expect(set?.getAttribute("href")).toBe("/project/7/track/3/session/1");
  });

  test("a closed row links to itself open, keeping the tab and the toggle", () => {
    renderPage({ show: "missing", library: true });

    const row = rowLinks().find((link) =>
      link.textContent?.includes("Lost Hat.wav")
    );
    expect(row?.getAttribute("href")).toBe(
      "/project/7/samples?show=missing&library=1&sample=%2FUsers%2Fdemo%2FLoops%2FLost+Hat.wav"
    );
  });

  test("a row keeps the stock chain drawn", () => {
    renderPage({ stock: true });

    const row = rowLinks().find((link) =>
      link.textContent?.includes("Lost Hat.wav")
    );
    expect(row?.getAttribute("href")).toBe(
      "/project/7/samples?stock=1&sample=%2FUsers%2Fdemo%2FLoops%2FLost+Hat.wav"
    );
  });

  test("a param naming no row expands nothing", () => {
    renderPage({
      expanded: { path: "/nowhere/Gone.wav", sessions: SAMPLE_SESSIONS },
    });

    expect(
      rowLinks().filter((link) => link.getAttribute("aria-current") === "true")
    ).toHaveLength(0);
    expect(screen.queryByText("Invented Track · ableton")).toBeNull();
  });

  test("marks a missing sample and shows a set's missing status", () => {
    renderPage({
      expanded: {
        path: KICK,
        sessions: [{ ...SAMPLE_SESSIONS[0]!, status: "missing" }],
      },
    });

    expect(screen.getAllByText("missing")).toHaveLength(2);
  });

  test("shows the empty line when the server left no sample", () => {
    renderPage({ samples: [], emptyLine: "Nothing missing." });

    expect(screen.getByText("Nothing missing.")).not.toBeNull();
  });
});
