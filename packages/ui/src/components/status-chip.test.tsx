import { StatusChip } from "@workspace/ui/components/status-chip";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("StatusChip", () => {
  it("keeps a tinted chip's text in the ambient ink", () => {
    render(
      // @ts-expect-error `ink` is only for a solid chip
      <StatusChip colour={"#f5f5f5"} ink={"#0a0a0a"}>
        IN PROGRESS
      </StatusChip>
    );

    const chip = screen.getByText("IN PROGRESS").closest("[data-slot]");
    expect(chip?.getAttribute("style") ?? "").not.toContain("--chip-ink");
  });

  it("sets the contrast ink on a solid chip", () => {
    render(
      <StatusChip solid colour={"#f5f5f5"} ink={"#0a0a0a"}>
        COMPLETE
      </StatusChip>
    );

    const chip = screen.getByText("COMPLETE").closest("[data-slot]");
    expect(chip?.getAttribute("style")).toContain("--chip-ink: #0a0a0a");
  });
});
