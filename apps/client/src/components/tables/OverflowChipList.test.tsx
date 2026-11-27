import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import { OverflowChipList } from "./OverflowChipList";

afterEach(cleanup);

describe("OverflowChipList", () => {
  const ITEMS = [
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" },
    { id: 3, name: "Gamma" },
    { id: 4, name: "Delta" },
  ];

  it("renders all items inline on a single non-wrapping line when within maxVisible", () => {
    const { container } = render(
      <OverflowChipList
        items={ITEMS.slice(0, 2)}
        maxVisible={2}
        getKey={(item) => item.id}
        overflowLabel="tags"
        renderItem={(item) => <span>{item.name}</span>}
      />,
      { wrapper: MotionProvider }
    );

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.firstElementChild?.className).toContain("flex-nowrap");
    expect(container.firstElementChild?.className).not.toContain("flex-wrap");
  });

  it("collapses overflow past maxVisible behind a +N pill that opens the full list", async () => {
    render(
      <OverflowChipList
        items={ITEMS}
        maxVisible={2}
        getKey={(item) => item.id}
        overflowLabel="tags"
        renderItem={(item) => <span>{item.name}</span>}
      />,
      { wrapper: MotionProvider }
    );

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();

    const pill = screen.getByRole("button", { name: "Show 2 more tags" });
    expect(pill.textContent).toBe("+2");

    await act(async () => {
      fireEvent.click(pill);
    });

    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.getByText("Delta")).toBeTruthy();
  });

  it("keeps the trailing control visible even when items is empty", () => {
    render(
      <OverflowChipList
        items={[]}
        getKey={(_, index) => index}
        renderItem={() => null}
        trailing={<button type="button">Add</button>}
      />,
      { wrapper: MotionProvider }
    );

    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
