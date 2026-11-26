import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

describe("DropdownMenuContent", () => {
  it("renders an open menu named by role", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper: MotionProvider }
    );

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("shows a submenu trigger and its own content", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Nested</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper: MotionProvider }
    );

    expect(screen.getByText("More")).toBeTruthy();
    expect(screen.getByText("Nested")).toBeTruthy();
  });
});

describe("DropdownMenuItem", () => {
  it("fires onClick and onSelect when clicked", () => {
    const onClick = mock<(event: unknown) => void>();
    const onSelect = mock<(event: unknown) => void>();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onClick} onSelect={onSelect}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper: MotionProvider }
    );

    fireEvent.click(screen.getByText("Delete"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu open when onSelect calls preventDefault", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
            Repeat: off
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper: MotionProvider }
    );

    fireEvent.click(screen.getByText("Repeat: off"));

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Repeat: off")).toBeTruthy();
  });

  it("closes the menu on a plain select with no prevention", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => {}}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper: MotionProvider }
    );

    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

describe("DropdownMenuCheckboxItem", () => {
  it("toggles aria-checked when clicked", () => {
    function Controlled() {
      const [checked, setChecked] = React.useState(false);
      return (
        <DropdownMenu open>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem
              checked={checked}
              onCheckedChange={setChecked}
            >
              Lyrics mode
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    render(<Controlled />, { wrapper: MotionProvider });

    const item = screen
      .getByText("Lyrics mode")
      .closest('[role="menuitemcheckbox"]')!;
    expect(item.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(item);

    expect(item.getAttribute("aria-checked")).toBe("true");
  });
});
