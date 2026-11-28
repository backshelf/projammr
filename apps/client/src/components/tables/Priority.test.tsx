import {
  HIGH,
  LEVEL_COLOURS,
  LOW,
  NONE,
  scaleLevel,
  URGENT,
} from "@/fields/priority-fixture";
import { cleanup, render } from "@testing-library/react";
import type { PriorityLevel } from "@workspace/api/api";
import { afterEach, describe, expect, it } from "bun:test";

import { PriorityBadge } from "./Priority";

afterEach(cleanup);

const chipOf = (level: PriorityLevel) => {
  const { container } = render(<PriorityBadge level={level} />);
  const chip = container.querySelector<HTMLElement>(
    '[data-slot="status-chip"]'
  );
  if (!chip) throw new Error("PriorityBadge drew no chip");
  return chip;
};

describe("PriorityBadge", () => {
  it("wears the level's own colour and names it", () => {
    const chip = chipOf(
      scaleLevel(30, "Blocking", 5, { colour: LEVEL_COLOURS.picked })
    );
    expect(chip.style.getPropertyValue("--status")).toBe(LEVEL_COLOURS.picked);
    expect(chip.textContent).toBe("Blocking");
  });

  it("draws the default level like any other, not as a dash", () => {
    const chip = chipOf(NONE);
    expect(chip.textContent).toBe("None");
    expect(chip.style.getPropertyValue("--status")).toBe(NONE.colour);
  });

  it("suppresses the default None level when hideDefault is set", () => {
    const { container } = render(<PriorityBadge level={NONE} hideDefault />);
    expect(container.querySelector('[data-slot="status-chip"]')).toBeNull();

    cleanup();
    const high = render(<PriorityBadge level={HIGH} hideDefault />);
    expect(
      high.container.querySelector('[data-slot="status-chip"]')?.textContent
    ).toBe("High");
  });

  it("gives every level the same weight, whatever its rank", () => {
    const bottom = chipOf(LOW).className;
    cleanup();
    const top = chipOf(URGENT).className;
    expect(top).toBe(bottom);
  });

  it("is a flag rather than a pipeline position, so it carries no pie", () => {
    expect(chipOf(HIGH).className).toContain("before:hidden");
  });
});
