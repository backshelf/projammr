import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import RightSideBlur from "./RightSideBlur";

afterEach(cleanup);

describe("RightSideBlur", () => {
  it("frames the stacked rail on both top and bottom edges below the stack breakpoint", () => {
    const { container } = render(
      <RightSideBlur>
        <div>Metadata</div>
      </RightSideBlur>
    );

    const rail = container.querySelector(".rail");
    expect(rail).not.toBeNull();
    expect(container.querySelector("aside#rightside")).not.toBeNull();
    const classes = rail!.className.split(/\s+/);
    expect(classes).toContain("stack:border-t");
    expect(classes).toContain("stack:border-b");
    expect(classes).toContain("stack:border-l-0");
    expect(classes).toContain("stack:border-rule");
  });
});
