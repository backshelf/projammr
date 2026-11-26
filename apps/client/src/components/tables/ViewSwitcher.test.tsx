import { CommandRegistry } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { VIEW_COMMANDS } from "@/components/commands/views";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

const router = {
  push: mock(),
  replace: mock(),
  refresh: mock(),
  prefetch: mock(),
};

mock.module("next/navigation", () => ({
  useRouter: mock(() => router),
  usePathname: mock(() => "/project/1/tracks"),
  useSearchParams: mock(() => new URLSearchParams("view=board")),
}));

const { ViewSwitcher } = await import("./ViewSwitcher");

afterEach(() => {
  cleanup();
  router.push.mockClear();
});

describe("ViewSwitcher", () => {
  it("writes view=list explicitly rather than deleting the param", () => {
    render(<ViewSwitcher current="board" />);
    fireEvent.click(screen.getByText("List"));
    expect(router.push).toHaveBeenCalledWith("/project/1/tracks?view=list");
  });

  it("writes view=board when switching the other way", () => {
    render(<ViewSwitcher current="list" />);
    fireEvent.click(screen.getByText("Board"));
    expect(router.push).toHaveBeenCalledWith("/project/1/tracks?view=board");
  });

  it("renders with no command registry above it", () => {
    render(<ViewSwitcher current="list" />);
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.getByText("Board")).toBeTruthy();
  });
});

describe("ViewSwitcher's b key", () => {
  const registry = (children: ReactNode) => (
    <CommandRegistry commands={VIEW_COMMANDS} context={{} as ActionContext}>
      {children}
    </CommandRegistry>
  );
  const pressB = () =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    });

  it("switches to the board from the list, as clicking Board does", () => {
    render(registry(<ViewSwitcher current="list" />));
    pressB();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/project/1/tracks?view=board");
  });

  it("switches to the list from the board, as clicking List does", () => {
    render(registry(<ViewSwitcher current="board" />));
    pressB();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/project/1/tracks?view=list");
  });

  it("does nothing once the switcher has unmounted", () => {
    const { unmount } = render(registry(<ViewSwitcher current="list" />));
    unmount();
    pressB();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("follows the view the page now shows", () => {
    const { rerender } = render(registry(<ViewSwitcher current="list" />));
    rerender(registry(<ViewSwitcher current="board" />));
    pressB();
    expect(router.push).toHaveBeenCalledWith("/project/1/tracks?view=list");
  });
});
