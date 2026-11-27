import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ComponentProps } from "react";
import type { RowCardModel } from "./row-card-model";

mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a href={typeof href === "string" ? href : ""} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

const { RowCard } = await import("./RowCard");

afterEach(cleanup);

const baseRow = (overrides: Partial<RowCardModel> = {}): RowCardModel => ({
  id: 1,
  href: "/project/1/track/1",
  title: "Midnight Static",
  fields: [],
  rowIndex: 0,
  ...overrides,
});

describe("RowCard", () => {
  it("renders title, single-line metadata text, and chips on separate tiers", () => {
    render(
      <RowCard
        entityLabel="track"
        row={baseRow({
          flag: "Main",
          subtitle: "LP One",
          fields: [
            { id: "bpm", label: "BPM", value: "128 BPM" },
            { id: "key", label: "Key", value: "F# minor" },
          ],
          status: {
            id: 1,
            name: "Mixing",
            colourHex: "var(--ink-soft)",
            percentage: 60,
          },
          priority: {
            id: 2,
            name: "High",
            colour: "var(--ink-soft)",
            rank: 1,
          } as RowCardModel["priority"],
        })}
      />
    );

    const title = screen.getByText("Midnight Static");
    const subtitle = screen.getByText("LP One");
    const status = screen.getByText("MIXING");
    const priority = screen.getByText("High");

    const metaContainer = subtitle.parentElement!;
    expect(metaContainer.className).toContain("truncate");
    expect(metaContainer.className).not.toContain("phone:line-clamp-2");
    expect(metaContainer.className).not.toContain("phone:whitespace-normal");

    // Metadata text and chips sit on distinct rows so chips never squeeze metadata.
    const statusChip = status.closest("[data-slot='status-chip']") ?? status;
    const priorityChip =
      priority.closest("[data-slot='status-chip']") ?? priority;
    expect(metaContainer.contains(statusChip)).toBe(false);
    expect(metaContainer.contains(priorityChip)).toBe(false);
    expect(statusChip.parentElement).toBe(priorityChip.parentElement);
    expect(statusChip.parentElement).not.toBe(title.parentElement);
  });

  it("omits empty metadata and chip tiers when a row has only a title", () => {
    render(<RowCard entityLabel="track" row={baseRow()} />);

    const link = screen.getByRole("link", { name: "Midnight Static" });
    const identity = link.firstElementChild!;
    expect(identity.children).toHaveLength(1);
  });

  it("applies content-visibility and intrinsic size on the outer listitem wrapper", () => {
    render(<RowCard entityLabel="track" row={baseRow()} />);

    const item = screen.getByRole("listitem");
    expect(item.className).toContain("[content-visibility:auto]");
    expect(item.className).toContain("[contain-intrinsic-size:auto_76px]");
  });
});
