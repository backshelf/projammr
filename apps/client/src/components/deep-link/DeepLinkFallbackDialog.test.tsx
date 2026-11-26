import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { DeepLinkFallbackDialog } from "./DeepLinkFallbackDialog";

afterEach(cleanup);

describe("DeepLinkFallbackDialog", () => {
  it("says the link needs dit on this computer", () => {
    render(<DeepLinkFallbackDialog open onOpenChange={() => {}} />);
    expect(
      screen.getByText("This link needs dit running on this computer.")
    ).toBeTruthy();
  });
});
