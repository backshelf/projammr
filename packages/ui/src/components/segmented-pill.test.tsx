import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
] as const;

describe("SegmentedPill", () => {
  it("marks the active option pressed and the other not", () => {
    render(
      <SegmentedPill
        options={[...OPTIONS]}
        value={"a"}
        onValueChange={() => {}}
        aria-label={"Side"}
      />
    );

    const [a, b] = screen.getAllByRole("button");
    expect(a!.getAttribute("aria-pressed")).toBe("true");
    expect(b!.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onValueChange with the clicked option's value", () => {
    const onValueChange = mock();
    render(
      <SegmentedPill
        options={[...OPTIONS]}
        value={"a"}
        onValueChange={onValueChange}
        aria-label={"Side"}
      />
    );

    fireEvent.click(screen.getAllByRole("button")[1]!);

    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("never reports an empty selection when the active pill is clicked again", () => {
    const onValueChange = mock();
    render(
      <SegmentedPill
        options={[...OPTIONS]}
        value={"a"}
        onValueChange={onValueChange}
        aria-label={"Side"}
      />
    );

    fireEvent.click(screen.getAllByRole("button")[0]!);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("disables every option and ignores clicks when disabled", () => {
    const onValueChange = mock();
    render(
      <SegmentedPill
        options={[...OPTIONS]}
        value={"a"}
        onValueChange={onValueChange}
        aria-label={"Side"}
        disabled
      />
    );

    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(buttons[1]!);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("names the group for a screen reader", () => {
    render(
      <SegmentedPill
        options={[...OPTIONS]}
        value={"a"}
        onValueChange={() => {}}
        aria-label={"Side"}
      />
    );

    expect(screen.getByRole("group", { name: "Side" })).not.toBeNull();
  });
});
