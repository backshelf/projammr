import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

describe("PopoverContent", () => {
  it("renders an open popover's content", () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Loudness detail</PopoverContent>
      </Popover>,
      { wrapper: MotionProvider }
    );

    const content = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"]'
    );
    expect(content).not.toBeNull();
    expect(content!.textContent).toBe("Loudness detail");
  });
});
