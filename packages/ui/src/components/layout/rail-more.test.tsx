import { RailMore } from "@workspace/ui/components/layout/rail-more";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

const block = (label: string) => <div key={label}>{label}</div>;
const lead = ["Status", "Priority", "Key", "Tempo"].map(block);
const tail = ["Created", "Updated"].map(block);

const foldedGroup = () => screen.getByText("Updated").parentElement!;

afterEach(cleanup);

describe("RailMore", () => {
  it("leaves the leading blocks in place and folds the rest away", () => {
    render(<RailMore more={tail}>{lead}</RailMore>);

    const toggle = screen.getByRole("button", { name: "More details" });
    for (const label of ["Status", "Priority", "Key", "Tempo"]) {
      expect(screen.getByText(label).parentElement).not.toBe(foldedGroup());
    }
    expect(screen.getByText("Created").parentElement).toBe(foldedGroup());
    expect(foldedGroup().classList.contains("hidden")).toBe(true);
    // happy-dom does not reflect ARIA attributes onto `ariaExpanded`.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("unfolds and refolds the group as the toggle is pressed", () => {
    render(<RailMore more={tail}>{lead}</RailMore>);

    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    expect(foldedGroup().classList.contains("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Fewer details" }));
    expect(foldedGroup().classList.contains("hidden")).toBe(true);
  });

  it("folds with a class, never the attribute preflight marks !important", () => {
    render(<RailMore more={tail}>{lead}</RailMore>);

    expect(foldedGroup().hidden).toBe(false);
  });

  it("dissolves into the rail grid at md: whether folded or not", () => {
    render(<RailMore more={tail}>{lead}</RailMore>);

    expect(foldedGroup().classList.contains("md:contents")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    expect(foldedGroup().classList.contains("md:contents")).toBe(true);
  });
});
