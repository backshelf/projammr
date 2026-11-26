import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

describe("TogglePill", () => {
  it("reports its pressed state through aria-pressed", () => {
    render(<TogglePill pressed={false}>Mono</TogglePill>);

    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  it("marks the pressed pill for the pressed-state styling", () => {
    render(<TogglePill pressed>Mono</TogglePill>);

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.hasAttribute("data-pressed")).toBe(true);
  });

  it("calls onPressedChange with the toggled state on click", () => {
    const onPressedChange = mock();
    render(
      <TogglePill pressed={false} onPressedChange={onPressedChange}>
        Dim
      </TogglePill>
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onPressedChange).toHaveBeenCalledWith(true, expect.anything());
  });
});
