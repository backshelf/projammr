import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("CollapsibleSection", () => {
  it("wraps the trigger button inside the heading rather than nesting h2 inside button", () => {
    render(
      <CollapsibleSection label="NOTES" count={2}>
        <p>Body</p>
      </CollapsibleSection>,
      { wrapper: MotionProvider }
    );

    const heading = screen.getByRole("heading", { level: 2 });
    const trigger = screen.getByRole("button", { name: /NOTES/ });
    expect(heading.contains(trigger)).toBe(true);
    expect(trigger.contains(heading)).toBe(false);
  });
});
