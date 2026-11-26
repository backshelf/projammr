import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

const panel = () =>
  document.querySelector<HTMLElement>('[data-slot="collapsible-content"]');

const TestCollapsible = ({
  keepMounted,
  ...props
}: React.ComponentProps<typeof Collapsible> & { keepMounted?: boolean }) => (
  <Collapsible {...props}>
    <CollapsibleTrigger>Toggle</CollapsibleTrigger>
    <CollapsibleContent keepMounted={keepMounted}>Body</CollapsibleContent>
  </Collapsible>
);

describe("CollapsibleContent", () => {
  it("renders the panel while open", () => {
    render(<TestCollapsible open />, { wrapper: MotionProvider });

    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute("inert")).toBeNull();
  });

  it("keeps a keepMounted panel in the DOM, inert, once closed", async () => {
    const { rerender } = render(<TestCollapsible open keepMounted />, {
      wrapper: MotionProvider,
    });
    expect(panel()).not.toBeNull();

    rerender(<TestCollapsible open={false} keepMounted />);

    await waitFor(() => {
      expect(panel()).not.toBeNull();
      expect(panel()!.getAttribute("inert")).not.toBeNull();
    });
    expect(panel()!.hasAttribute("hidden")).toBe(false);
  });

  it("unmounts a panel with no keepMounted once it closes", async () => {
    const { rerender } = render(<TestCollapsible open />, {
      wrapper: MotionProvider,
    });
    expect(panel()).not.toBeNull();

    rerender(<TestCollapsible open={false} />);

    await waitFor(() => expect(panel()).toBeNull());
  });
});
