import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

describe("TooltipContent", () => {
  it("renders an open tooltip's content", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Loudest master</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
      { wrapper: MotionProvider }
    );

    const content = document.querySelector<HTMLElement>(
      '[data-slot="tooltip-content"]'
    );
    expect(content).not.toBeNull();
    expect(content!.textContent).toBe("Loudest master");
  });
});
