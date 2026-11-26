import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "./motion-provider";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

const indicator = (name: string) =>
  screen
    .getByRole("tab", { name })
    .querySelector('[data-slot="tabs-indicator"]');

const TestTabs = (props: React.ComponentProps<typeof Tabs>) => (
  <Tabs {...props}>
    <TabsList>
      <TabsTrigger value="a">A</TabsTrigger>
      <TabsTrigger value="b">B</TabsTrigger>
    </TabsList>
  </Tabs>
);

describe("TabsTrigger", () => {
  it("holds the indicator on the active tab only", () => {
    render(<TestTabs defaultValue="a" />, { wrapper: MotionProvider });

    expect(indicator("A")).not.toBeNull();
    expect(indicator("B")).toBeNull();
  });

  it("moves the indicator to the tab that becomes active", () => {
    const { rerender } = render(<TestTabs value="a" />, {
      wrapper: MotionProvider,
    });
    expect(indicator("A")).not.toBeNull();

    rerender(<TestTabs value="b" />);

    expect(indicator("A")).toBeNull();
    expect(indicator("B")).not.toBeNull();
  });
});

describe("Tabs onValueChange", () => {
  it("fires once when a different tab is picked", () => {
    const onValueChange = mock<(value: unknown) => void>();
    render(<TestTabs defaultValue="a" onValueChange={onValueChange} />, {
      wrapper: MotionProvider,
    });

    fireEvent.click(screen.getByRole("tab", { name: "B" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe("b");
  });

  it("does not fire when the already-active tab is clicked again", () => {
    const onValueChange = mock<(value: unknown) => void>();
    render(<TestTabs defaultValue="a" onValueChange={onValueChange} />, {
      wrapper: MotionProvider,
    });

    fireEvent.click(screen.getByRole("tab", { name: "A" }));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
