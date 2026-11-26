import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

function TestSelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select {...props}>
      <SelectTrigger>
        <SelectValue placeholder="Choose a key" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="c">C major</SelectItem>
        <SelectItem value="g">G major</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("fires onValueChange with the picked item's value", () => {
    const onValueChange = mock<(value: string | null) => void>();
    render(<TestSelect open onValueChange={onValueChange} />, {
      wrapper: MotionProvider,
    });

    // A pointerdown must land on the item before its click counts as a real
    // pick — `alignItemWithTrigger` can place an item under the cursor at
    // open time, and Base UI ignores a click with no pointerdown of its own
    // so that placement can't auto-select.
    const item = screen.getByText("G major");
    fireEvent.pointerDown(item);
    fireEvent.click(item);

    expect(onValueChange).toHaveBeenCalledWith("g", expect.anything());
  });
});

describe("Select items", () => {
  const items = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];

  function ItemsSelect(props: Partial<React.ComponentProps<typeof Select>>) {
    return (
      <Select items={items} {...props}>
        <SelectTrigger>
          <SelectValue placeholder="Choose a key" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const triggerText = () =>
    document.querySelector<HTMLElement>('[data-slot="select-trigger"]')
      ?.textContent;

  it("shows the picked item's label in the trigger, not its raw value", () => {
    render(<ItemsSelect value="b" />, { wrapper: MotionProvider });

    expect(triggerText()).toBe("Beta");
  });

  it("shows the placeholder when no value is set", () => {
    render(<ItemsSelect />, { wrapper: MotionProvider });

    expect(triggerText()).toBe("Choose a key");
  });
});
