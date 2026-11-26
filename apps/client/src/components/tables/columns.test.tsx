import { HIGH, LOW, scaleLevel } from "@/fields/priority-fixture";
import { cleanup, render } from "@testing-library/react";
import type { PriorityLevel } from "@workspace/api/api";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ComponentProps, ReactNode } from "react";

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const {
  countColumn,
  navigableColumnIds,
  priorityColumn,
  relativeDateColumn,
  TitleCell,
} = await import("./columns");
const { createAppColumnHelper } = await import("./data-table-hook");
const { FormatProvider } =
  await import("@workspace/ui/components/format-provider");
const { DEFAULT_FORMAT_PREFS, defaultFormatters } =
  await import("@workspace/ui/lib/formatters");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");

afterEach(cleanup);

describe("TitleCell", () => {
  const row = { title: "Nocturne", cover: "/cover.jpg" };
  const config = {
    href: () => "/track/1",
    image: (r: typeof row) => r.cover,
    trailing: () => <button type="button">Play</button>,
  };

  it("holds the thumb and the title in one link", () => {
    const { container } = render(
      <TitleCell row={row} config={config}>
        {row.title}
      </TitleCell>
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/track/1");
    expect(link?.textContent).toBe("Nocturne");
    expect(link?.querySelector('[data-slot="track-cell"]')).not.toBeNull();
  });

  it("keeps the trailing slot outside the link", () => {
    const { container, getByText } = render(
      <TitleCell row={row} config={config}>
        {row.title}
      </TitleCell>
    );

    expect(container.querySelector("a")?.contains(getByText("Play"))).toBe(
      false
    );
  });

  it("draws a bare link when the column has no image or trailing slot", () => {
    const { container } = render(
      <TitleCell row={row} config={{ href: () => "/track/1" }}>
        {row.title}
      </TitleCell>
    );

    expect(container.firstElementChild?.tagName).toBe("A");
    expect(container.querySelector('[data-slot="track-cell"]')).toBeNull();
  });

  it("shows the thumb when tables.thumbnails is on", () => {
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.thumbnails": true }, "v1")}
      >
        <TitleCell row={row} config={config}>
          {row.title}
        </TitleCell>
      </SettingsProvider>
    );

    expect(container.querySelector('[data-slot="track-cell"]')).not.toBeNull();
  });

  it("hides the thumb when tables.thumbnails is off", () => {
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.thumbnails": false }, "v1")}
      >
        <TitleCell row={row} config={config}>
          {row.title}
        </TitleCell>
      </SettingsProvider>
    );

    expect(container.querySelector('[data-slot="track-cell"]')).toBeNull();
    expect(container.querySelector("a")?.textContent).toBe("Nocturne");
  });
});

type Row = { at: string | null; n: number | null };

function renderCell(column: { cell?: unknown }, row: Row) {
  const cell = column.cell as (info: { getValue: () => unknown }) => ReactNode;
  const getValue = () =>
    (column as { accessorFn: (r: Row) => unknown }).accessorFn(row);
  return render(<>{cell({ getValue })}</>);
}

describe("relativeDateColumn", () => {
  const column = relativeDateColumn(createAppColumnHelper<Row>(), {
    id: "at",
    header: "At",
    value: (row) => row.at,
  });

  it("renders relative text with the absolute date as its title", () => {
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { container } = renderCell(column, { at, n: 0 });

    const time = container.querySelector("time");
    expect(time?.textContent).toBe("3 days ago");
    expect(time?.getAttribute("title")).toBe(defaultFormatters().dateTime(at));
  });

  it("words the date as the viewer's formats say", () => {
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const cell = column.cell as (info: {
      getValue: () => unknown;
    }) => ReactNode;
    const { container } = render(
      <FormatProvider
        prefs={{ ...DEFAULT_FORMAT_PREFS, relativeWording: "short" }}
        zone="UTC"
      >
        {cell({ getValue: () => at })}
      </FormatProvider>
    );

    expect(container.querySelector("time")?.textContent).toBe("3d");
  });

  it("renders a dash when there is no date", () => {
    const { container } = renderCell(column, { at: null, n: 0 });

    expect(container.textContent).toBe("—");
    expect(container.querySelector("time")).toBeNull();
  });

  it("keeps the relative form when tables.dateColumns is relative", () => {
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const cell = column.cell as (info: {
      getValue: () => unknown;
    }) => ReactNode;
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.dateColumns": "relative" }, "v1")}
      >
        {cell({ getValue: () => at })}
      </SettingsProvider>
    );

    expect(container.querySelector("time")?.textContent).toBe("3 days ago");
  });

  it("renders the absolute date when tables.dateColumns is absolute", () => {
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const cell = column.cell as (info: {
      getValue: () => unknown;
    }) => ReactNode;
    const { container } = render(
      <SettingsProvider
        initial={effectiveSettings({ "tables.dateColumns": "absolute" }, "v1")}
      >
        {cell({ getValue: () => at })}
      </SettingsProvider>
    );

    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).toBe(defaultFormatters().dateTime(at));
  });
});

describe("countColumn", () => {
  const column = countColumn(createAppColumnHelper<Row>(), {
    id: "n",
    header: "N",
    value: (row) => row.n,
  });

  it("renders 0 when the row has no count", () => {
    expect(
      renderCell(column, { at: null, n: null }).container.textContent
    ).toBe("0");
  });

  it("renders the count", () => {
    expect(renderCell(column, { at: null, n: 12 }).container.textContent).toBe(
      "12"
    );
  });
});

describe("priorityColumn", () => {
  type LevelRow = { priority: PriorityLevel };
  const column = priorityColumn(
    createAppColumnHelper<LevelRow>()
  ) as unknown as {
    id: string;
    accessorFn: (row: LevelRow) => unknown;
    sortFn: (a: { original: LevelRow }, b: { original: LevelRow }) => number;
    cell: (info: { row: { original: LevelRow } }) => ReactNode;
  };
  const high = { priority: HIGH };
  const low = { priority: LOW };

  it("keeps the id the server sorts and groups by", () => {
    expect(column.id).toBe("priority");
  });

  it("draws the level the row carries, in its colour, even one the scale no longer has", () => {
    const gone = { priority: scaleLevel(99, "Retired", 7) };
    const { container } = render(
      <>{column.cell({ row: { original: gone } })}</>
    );
    const chip = container.querySelector<HTMLElement>(
      '[data-slot="status-chip"]'
    );
    expect(chip?.textContent).toBe("Retired");
    expect(chip?.style.getPropertyValue("--status")).toBe(gone.priority.colour);
  });

  it("holds the level's name, which a copied cell carries and a paste parses back", () => {
    expect(column.accessorFn(high)).toBe("High");
  });

  it("orders rows by rank, not by name", () => {
    expect(column.sortFn({ original: low }, { original: high })).toBeLessThan(
      0
    );
    expect(
      column.sortFn({ original: high }, { original: low })
    ).toBeGreaterThan(0);
  });
});

describe("navigableColumnIds", () => {
  const columns = [
    { id: "play" },
    { id: "trackNumber" },
    { id: "title" },
    { id: "artists" },
    { id: "lufs" },
    {},
  ];

  it("returns the identity column and the editable columns in column order", () => {
    expect(
      navigableColumnIds(columns, { artists: {}, trackNumber: {} }, "title")
    ).toEqual(["trackNumber", "title", "artists"]);
  });

  it("returns only the identity column when nothing is editable", () => {
    expect(navigableColumnIds(columns, {}, "title")).toEqual(["title"]);
  });
});
