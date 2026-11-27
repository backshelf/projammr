import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { InstanceMachinesPage } from "@workspace/api/api";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import type { ComponentProps } from "react";

mock.module("next/navigation", () => ({
  usePathname: () => "/settings/instance/machines",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a href={String(href)} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

const { AdminMachinesTable } = await import("./AdminMachinesTable");

const format = defaultFormatters("UTC");

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3600 * 1000).toISOString();

const page = (
  items: InstanceMachinesPage["items"],
  total = items.length
): InstanceMachinesPage => ({ items, total });

const machine = (
  over: Partial<InstanceMachinesPage["items"][number]> = {}
): InstanceMachinesPage["items"][number] => ({
  id: "machine-0001-abcdef",
  name: "Studio Mac",
  platform: "macOS",
  appVersion: "0.10.0",
  lastSeenAt: hoursAgo(3),
  owner: { id: "u1", name: "Alex" },
  ...over,
});

afterEach(cleanup);

describe("AdminMachinesTable", () => {
  it("heads its columns Owner, Machine, Platform, Version and Last seen", () => {
    render(
      <AdminMachinesTable
        data={page([machine()])}
        page={1}
        pageSize={20}
        format={format}
      />
    );

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent)
    ).toEqual(["Owner", "Machine", "Platform", "Version", "Last seen"]);
  });

  it("lists every account's machines with whose each is", () => {
    render(
      <AdminMachinesTable
        data={page([
          machine(),
          machine({
            id: "machine-0002-abcdef",
            name: "Laptop",
            platform: "Linux",
            appVersion: "0.9.2",
            lastSeenAt: hoursAgo(72),
            owner: { id: "u2", name: "Ada" },
          }),
        ])}
        page={1}
        pageSize={20}
        format={format}
      />
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells(rows[0]!)).toEqual([
      "Alex",
      "Studio Mac",
      "macOS",
      "0.10.0",
      "3 hours ago",
    ]);
    expect(cells(rows[1]!)).toEqual([
      "Ada",
      "Laptop",
      "Linux",
      "0.9.2",
      "3 days ago",
    ]);
  });

  it("is read-only: no button acts on a machine", () => {
    render(
      <AdminMachinesTable
        data={page([machine()])}
        page={1}
        pageSize={20}
        format={format}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when no machine has signed in", () => {
    render(
      <AdminMachinesTable
        data={page([])}
        page={1}
        pageSize={20}
        format={format}
      />
    );

    expect(screen.getByText(/No machine has signed in/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a single entity table container without a duplicate TableScroll wrapper", () => {
    const { container } = render(
      <AdminMachinesTable
        data={page([machine()])}
        page={1}
        pageSize={20}
        format={format}
      />
    );

    expect(container.querySelector('[data-slot="table-scroll"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-slot="table-container"]')
    ).toHaveLength(1);
  });

  it("pages when there are more machines than a page holds", () => {
    render(
      <AdminMachinesTable
        data={page([machine()], 45)}
        page={2}
        pageSize={20}
        format={format}
      />
    );

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Prev/ }).getAttribute("href")
    ).toBe("/settings/instance/machines?page=1");
  });
});
