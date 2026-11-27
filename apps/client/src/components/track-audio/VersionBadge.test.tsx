import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { VersionBadge } from "./VersionBadge";

afterEach(cleanup);

describe("VersionBadge", () => {
  it("formats a version number with tabular numerals", () => {
    render(<VersionBadge version={12} />);

    const badge = screen.getByText("v12");
    expect(badge.className).toContain("tabular-nums");
    expect(badge.className).not.toContain("bg-art");
  });

  it("renders an em dash when version is missing and highlights when active", () => {
    render(<VersionBadge version={null} active />);

    const badge = screen.getByText("—");
    expect(badge.className).toContain("tabular-nums");
    expect(badge.className).toContain("bg-art");
  });
});
