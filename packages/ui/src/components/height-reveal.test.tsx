import { HeightReveal } from "@workspace/ui/components/height-reveal";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

const panel = () =>
  document.querySelector<HTMLElement>("[data-slot=height-reveal]")!;

describe("HeightReveal", () => {
  it("mounts nothing while it starts closed", () => {
    render(<HeightReveal open={false}>Rack</HeightReveal>);

    expect(screen.queryByText("Rack")).toBeNull();
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("mounts its children and marks itself open when it opens", () => {
    const { rerender } = render(<HeightReveal open={false}>Rack</HeightReveal>);
    rerender(<HeightReveal open>Rack</HeightReveal>);

    expect(screen.getByText("Rack")).toBeDefined();
    expect(panel().hasAttribute("data-open")).toBe(true);
    expect(panel().hasAttribute("inert")).toBe(false);
  });

  it("keeps its children through the close until the track settles", () => {
    const { rerender } = render(<HeightReveal open>Rack</HeightReveal>);
    rerender(<HeightReveal open={false}>Rack</HeightReveal>);

    expect(screen.getByText("Rack")).toBeDefined();

    fireEvent.transitionEnd(panel(), { propertyName: "grid-template-rows" });

    expect(screen.queryByText("Rack")).toBeNull();
  });

  it("ignores a transition that ends inside the panel", () => {
    const { rerender } = render(
      <HeightReveal open>
        <span data-testid="inner">Rack</span>
      </HeightReveal>
    );
    rerender(
      <HeightReveal open={false}>
        <span data-testid="inner">Rack</span>
      </HeightReveal>
    );

    fireEvent.transitionEnd(screen.getByTestId("inner"), {
      propertyName: "grid-template-rows",
    });

    expect(screen.getByTestId("inner")).toBeDefined();
  });
});
