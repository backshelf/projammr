import { MotionProvider } from "@workspace/ui/components/motion-provider";
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerItem,
  ResponsivePickerList,
  ResponsivePickerSearch,
  ResponsivePickerTrigger,
  type ResponsivePickerOption,
} from "@workspace/ui/components/responsive-picker";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const OPTIONS: ResponsivePickerOption[] = [
  { value: "mixing", label: "Mixing" },
  { value: "mastering", label: "Mastering" },
  { value: "done", label: "Done", description: "Ready for release" },
];

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const originalWidth = window.innerWidth;

beforeEach(() => {
  setViewportWidth(1024);
});

afterEach(() => {
  cleanup();
  setViewportWidth(originalWidth);
});

describe("ResponsivePicker (desktop)", () => {
  it("opens a Popover on desktop viewports and selects an option", async () => {
    const onSelect = mock<(value: string) => void>();
    render(
      <ResponsivePicker
        title="Status"
        options={OPTIONS}
        value="mixing"
        onSelect={onSelect}
        trigger={<button type="button">Pick status</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pick status" }));
    });

    expect(
      document.querySelector('[data-slot="responsive-picker-popover"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-slot="responsive-picker-sheet"]')
    ).toBeNull();

    const mixingOption = screen.getByRole("option", { name: /Mixing/ });
    expect(mixingOption.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Mastering/ }));
    });

    expect(onSelect).toHaveBeenCalledWith("mastering");
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="responsive-picker-popover"]')
      ).toBeNull()
    );
  });

  it("filters options, shows empty state, and supports create and clear actions", async () => {
    const onCreate = mock<(query: string) => void>();
    const onClear = mock<() => void>();
    render(
      <ResponsivePicker
        title="Labels"
        options={OPTIONS}
        searchable
        searchPlaceholder="Filter labels…"
        emptyLabel="Nothing matches."
        onCreate={onCreate}
        onClear={onClear}
        clearLabel="Remove label"
        trigger={<button type="button">Labels</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Labels" }));
    });

    const search = screen.getByPlaceholderText("Filter labels…");
    await act(async () => {
      fireEvent.change(search, { target: { value: "Ambient" } });
    });

    expect(screen.queryByRole("option", { name: /Mixing/ })).toBeNull();
    const createBtn = screen.getByRole("button", { name: /Create “Ambient”/ });
    await act(async () => {
      fireEvent.click(createBtn);
    });
    expect(onCreate).toHaveBeenCalledWith("Ambient");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Labels" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove label" }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows emptyLabel when no options match and creation is disabled", async () => {
    render(
      <ResponsivePicker
        title="Status"
        options={OPTIONS}
        searchable
        emptyLabel="No statuses found."
        trigger={<button type="button">Status</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Status" }));
    });
    await act(async () => {
      fireEvent.change(
        screen.getByRole("textbox", { name: "Filter options" }),
        {
          target: { value: "zzz" },
        }
      );
    });

    expect(screen.getByText("No statuses found.")).toBeTruthy();
  });

  it("supports ArrowDown, ArrowUp, Home, and End focus navigation across enabled items in listbox", async () => {
    render(
      <ResponsivePicker
        title="Nav"
        trigger={<button type="button">Nav</button>}
      >
        <ResponsivePickerContent title="Nav">
          <ResponsivePickerList>
            <ResponsivePickerItem>Alpha</ResponsivePickerItem>
            <ResponsivePickerItem disabled>Disabled</ResponsivePickerItem>
            <ResponsivePickerItem>Beta</ResponsivePickerItem>
            <ResponsivePickerItem>Gamma</ResponsivePickerItem>
          </ResponsivePickerList>
        </ResponsivePickerContent>
      </ResponsivePicker>,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nav" }));
    });

    const list = screen.getByRole("listbox");
    const alpha = screen.getByRole("option", { name: "Alpha" });
    const beta = screen.getByRole("option", { name: "Beta" });
    const gamma = screen.getByRole("option", { name: "Gamma" });

    alpha.focus();
    expect(document.activeElement).toBe(alpha);

    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(document.activeElement).toBe(beta);

    fireEvent.keyDown(beta, { key: "End" });
    expect(document.activeElement).toBe(gamma);

    fireEvent.keyDown(gamma, { key: "ArrowUp" });
    expect(document.activeElement).toBe(beta);

    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(alpha);
  });

  it("auto-closes on item click in custom composition mode when closeOnSelect is true", async () => {
    const onOpenChange = mock<(open: boolean) => void>();
    render(
      <ResponsivePicker
        onOpenChange={onOpenChange}
        trigger={<button type="button">Custom</button>}
      >
        <ResponsivePickerContent title="Custom">
          <ResponsivePickerList>
            <ResponsivePickerItem>Alpha</ResponsivePickerItem>
          </ResponsivePickerList>
        </ResponsivePickerContent>
      </ResponsivePicker>,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    });
    expect(
      document.querySelector('[data-slot="responsive-picker-popover"]')
    ).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="responsive-picker-popover"]')
      ).toBeNull()
    );
  });

  it("hides the clear action when showClear={false} even if onClear is passed", async () => {
    const onClear = mock<() => void>();
    render(
      <ResponsivePicker
        title="Genre"
        options={OPTIONS}
        value="mixing"
        showClear={false}
        onClear={onClear}
        clearLabel="Clear"
        trigger={<button type="button">Genre</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Genre" }));
    });

    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("calls onOpenChange(false) once when selecting a built-in option", async () => {
    const onSelect = mock<(value: string) => void>();
    const onOpenChange = mock<(open: boolean) => void>();
    render(
      <ResponsivePicker
        title="Status"
        options={OPTIONS}
        onSelect={onSelect}
        onOpenChange={onOpenChange}
        trigger={<button type="button">Pick</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    });
    onOpenChange.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Mastering/ }));
    });

    expect(onSelect).toHaveBeenCalledWith("mastering");
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ResponsivePicker (mobile)", () => {
  beforeEach(() => {
    setViewportWidth(390);
  });

  it("renders a bottom Sheet with 44px hairline rows and a 16px non-autofocused search input", async () => {
    const onSelect = mock<(value: string) => void>();
    render(
      <ResponsivePicker
        title="Track priority"
        description="Choose priority level"
        options={OPTIONS}
        searchable
        searchPlaceholder="Search priority…"
        onSelect={onSelect}
        trigger={<button type="button">Priority</button>}
      />,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    });

    const sheet = document.querySelector<HTMLElement>(
      '[data-slot="responsive-picker-sheet"]'
    );
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute("data-side")).toBe("bottom");
    expect(sheet?.className).toContain("max-h-[85dvh]");
    expect(screen.getByText("Track priority")).toBeTruthy();
    expect(screen.getByText("Choose priority level")).toBeTruthy();

    const search = screen.getByPlaceholderText("Search priority…");
    expect(search.className).toContain("text-base");
    expect(search.className).toContain("min-h-11");
    expect(document.activeElement).not.toBe(search);

    const list = document.querySelector<HTMLElement>(
      '[data-slot="responsive-picker-list"]'
    );
    expect(list?.className).toContain("divide-y");
    expect(list?.className).toContain("divide-rule");

    const row = screen.getByRole("option", { name: /Mixing/ });
    expect(row.className).toContain("min-h-11");

    await act(async () => {
      fireEvent.click(row);
    });
    expect(onSelect).toHaveBeenCalledWith("mixing");
  });

  it("supports compound composition inside a mobile sheet", async () => {
    render(
      <ResponsivePicker>
        <ResponsivePickerTrigger asChild>
          <button type="button">Open custom</button>
        </ResponsivePickerTrigger>
        <ResponsivePickerContent title="Custom picker">
          <ResponsivePickerSearch placeholder="Type…" />
          <ResponsivePickerList>
            <ResponsivePickerItem selected>First</ResponsivePickerItem>
            <ResponsivePickerItem>Second</ResponsivePickerItem>
          </ResponsivePickerList>
        </ResponsivePickerContent>
      </ResponsivePicker>,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open custom" }));
    });

    expect(
      document.querySelector('[data-slot="responsive-picker-sheet"]')
    ).not.toBeNull();
    expect(
      screen
        .getByRole("option", { name: "First" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });
});
