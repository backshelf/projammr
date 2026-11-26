import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { HubNavSection } from "@/components/settings-hub/HubNav";

// `mock.module` is not hoisted: it must run before `HubNav` is imported, since
// that import is what evaluates `next/link`.
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

const { HubNav } = await import("@/components/settings-hub/HubNav");

const sections: HubNavSection[] = [
  {
    id: "project",
    label: "Project",
    detail: "Night Drive",
    href: "/settings/project/1",
    entries: [],
    hasPanes: false,
  },
];

describe("HubNav", () => {
  afterEach(cleanup);

  it("draws a section's detail in soft ink, dark enough to read at its size", () => {
    render(<HubNav sections={sections} place={{ section: "project" }} />);

    const detail = screen.getByText("Night Drive");
    expect(detail.className).toContain("text-ink-soft");
    expect(detail.className).not.toContain("text-ink-faint");
  });
});
