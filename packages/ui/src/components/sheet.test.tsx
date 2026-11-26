import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { cn } from "../lib/utils";
import { MotionProvider } from "./motion-provider";
import {
  EDGE_SPACER,
  Sheet,
  SheetContent,
  SheetTitle,
  SIDE_CLASSES,
  type SheetSide,
} from "./sheet";

afterEach(cleanup);

describe("SIDE_CLASSES", () => {
  it("yields the width to a consumer's own", () => {
    const merged = cn(SIDE_CLASSES.right, "w-full sm:max-w-[27rem]");

    expect(merged).toContain("w-full");
    expect(merged).toContain("sm:max-w-[27rem]");
    expect(merged).not.toContain("w-3/4");
    expect(merged).not.toContain("sm:max-w-sm");
  });

  it("yields the height to a consumer's own", () => {
    const merged = cn(SIDE_CLASSES.bottom, "h-dvh");

    expect(merged).toContain("h-dvh");
    expect(merged).not.toContain("h-auto");
  });

  it.each(["p-0", "py-2", "pb-4"])(
    "keeps the home-indicator clearance on a bottom sheet under %s",
    (padding) => {
      const merged = cn(SIDE_CLASSES.bottom, padding);

      expect(merged).toContain("after:block");
      expect(merged).toContain("after:h-[env(safe-area-inset-bottom)]");
      expect(merged).toContain("after:shrink-0");
      expect(merged).toContain(padding);
    }
  );

  it("clears the home indicator on every side that reaches it", () => {
    for (const side of ["bottom", "left", "right"] as const) {
      expect(SIDE_CLASSES[side]).toContain(EDGE_SPACER);
    }
  });

  it("leaves the clearance off a top sheet", () => {
    expect(SIDE_CLASSES.top).not.toContain("safe-area-inset-bottom");
  });

  it("carries placement only, leaving the travel to Motion", () => {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      expect(SIDE_CLASSES[side]).not.toMatch(/slide-|animate-/);
    }
  });
});

const overlay = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
const content = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]');

type TestSheetProps = React.ComponentProps<typeof Sheet> & {
  side?: SheetSide;
  className?: string;
  onClosed?: () => void;
  dismissOnOutside?: boolean;
  swipe?: boolean;
};

const TestSheet = ({
  side = "bottom",
  className,
  onClosed,
  dismissOnOutside,
  swipe,
  ...props
}: TestSheetProps) => (
  <Sheet {...props}>
    <SheetContent
      side={side}
      className={className}
      onClosed={onClosed}
      dismissOnOutside={dismissOnOutside}
      swipe={swipe}
    >
      <SheetTitle>Row actions</SheetTitle>
    </SheetContent>
  </Sheet>
);

describe("SheetContent", () => {
  const openSheet = (props: TestSheetProps = {}) =>
    render(<TestSheet open {...props} />, { wrapper: MotionProvider });

  it("refuses selection on the scrim and the panel above it", () => {
    openSheet();

    for (const element of [overlay()!, content()!]) {
      expect(element.classList.contains("select-none")).toBe(true);
      expect(element.classList.contains("[-webkit-touch-callout:none]")).toBe(
        true
      );
    }
  });

  it("keeps the home-indicator spacer when a consumer sets its own padding", () => {
    openSheet({ className: "p-0" });

    expect(
      content()!.classList.contains("after:h-[env(safe-area-inset-bottom)]")
    ).toBe(true);
    expect(content()!.classList.contains("p-0")).toBe(true);
  });

  it("still renders its children", () => {
    openSheet();

    expect(screen.getByText("Row actions")).toBeTruthy();
  });

  it("is a dialog named by its title", () => {
    openSheet();

    expect(screen.getByRole("dialog", { name: "Row actions" })).toBeTruthy();
  });

  it("dismisses a bottom sheet with a downward swipe", () => {
    openSheet({ side: "bottom" });

    expect(content()!.getAttribute("data-swipe-direction")).toBe("down");
  });

  it("dismisses a right sheet with a swipe to the right", () => {
    openSheet({ side: "right" });

    expect(content()!.getAttribute("data-swipe-direction")).toBe("right");
  });

  it("draws a grabber on a bottom sheet", () => {
    openSheet({ side: "bottom" });

    expect(content()!.querySelectorAll("[aria-hidden]").length).toBe(1);
  });

  it("draws no grabber on a side sheet", () => {
    openSheet({ side: "right" });

    expect(content()!.querySelectorAll("[aria-hidden]").length).toBe(0);
  });

  it("draws no grabber when swipe is off", () => {
    render(<TestSheet open side="bottom" swipe={false} />, {
      wrapper: MotionProvider,
    });

    expect(content()!.querySelectorAll("[aria-hidden]").length).toBe(0);
  });
});

describe("Sheet dismissal", () => {
  const pressOutside = async () => {
    await act(async () => {
      const target = overlay()!;
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    });
  };

  it("closes on a press outside by default", async () => {
    const onOpenChange = mock<(open: boolean) => void>();
    render(<TestSheet open onOpenChange={onOpenChange} />, {
      wrapper: MotionProvider,
    });

    await pressOutside();

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("stays open on a press outside when dismissOnOutside is off", async () => {
    const onOpenChange = mock<(open: boolean) => void>();
    render(
      <TestSheet open onOpenChange={onOpenChange} dismissOnOutside={false} />,
      { wrapper: MotionProvider }
    );

    await pressOutside();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(content()).not.toBeNull();
  });
});

describe("onClosed", () => {
  it("fires once, after the panel is gone, on a controlled close", async () => {
    const seen: (HTMLElement | null)[] = [];
    const onClosed = mock(() => {
      seen.push(content());
    });
    const { rerender } = render(<TestSheet open onClosed={onClosed} />, {
      wrapper: MotionProvider,
    });
    expect(onClosed).not.toHaveBeenCalled();

    rerender(<TestSheet open={false} onClosed={onClosed} />);

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([null]);
    expect(overlay()).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("fires once, after the panel is gone, on an Escape close", async () => {
    const seen: (HTMLElement | null)[] = [];
    const onClosed = mock(() => {
      seen.push(content());
    });
    render(<TestSheet defaultOpen onClosed={onClosed} />, {
      wrapper: MotionProvider,
    });
    expect(content()).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(content()!, { key: "Escape" });
    });

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([null]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the sheet stays open", async () => {
    const onClosed = mock(() => {});
    const { unmount } = render(<TestSheet open onClosed={onClosed} />, {
      wrapper: MotionProvider,
    });

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onClosed).not.toHaveBeenCalled();
  });
});
