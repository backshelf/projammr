import { RailBlock } from "@workspace/ui/components/layout/rail";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("RailBlock", () => {
  it("renders a plain block with neither `grid` nor `rows` set", () => {
    render(<RailBlock data-testid="block">content</RailBlock>);

    const block = screen.getByTestId("block");
    expect(block.classList.contains("grid")).toBe(false);
    expect(block.classList.contains("flex-col")).toBe(false);
  });

  it("lays a `grid` block out as a two-up grid, for a short field pair", () => {
    render(
      <RailBlock grid data-testid="block">
        content
      </RailBlock>
    );

    const block = screen.getByTestId("block");
    expect(block.classList.contains("grid-cols-2")).toBe(true);
    expect(block.classList.contains("flex-col")).toBe(false);
  });

  it("lays a `rows` block out as full-width stacked rows, for a longer field pair", () => {
    render(
      <RailBlock rows data-testid="block">
        content
      </RailBlock>
    );

    const block = screen.getByTestId("block");
    expect(block.classList.contains("flex-col")).toBe(true);
    expect(block.classList.contains("grid-cols-2")).toBe(false);
  });
});
