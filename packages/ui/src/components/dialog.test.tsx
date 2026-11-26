import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

const overlay = () =>
  document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
const content = () =>
  document.querySelector<HTMLElement>('[data-slot="dialog-content"]');

const TestDialog = (props: React.ComponentProps<typeof Dialog>) => (
  <Dialog {...props}>
    <DialogContent>
      <DialogTitle>Delete track</DialogTitle>
    </DialogContent>
  </Dialog>
);

describe("DialogOverlay", () => {
  it("refuses selection on the scrim", () => {
    render(<TestDialog open />, { wrapper: MotionProvider });

    expect(overlay()!.classList.contains("select-none")).toBe(true);
    expect(overlay()!.classList.contains("[-webkit-touch-callout:none]")).toBe(
      true
    );
  });

  it("leaves the panel selectable so dialog inputs still take a drag", () => {
    render(<TestDialog open />, { wrapper: MotionProvider });

    expect(content()!.classList.contains("select-none")).toBe(false);
  });
});

describe("Dialog", () => {
  it("renders an open dialog named by its title", () => {
    render(<TestDialog open />, { wrapper: MotionProvider });

    expect(screen.getByRole("dialog", { name: "Delete track" })).toBeTruthy();
  });

  it("unmounts the panel and scrim once a controlled close finishes", async () => {
    const onOpenChangeComplete = mock<(open: boolean) => void>();
    const { rerender } = render(
      <TestDialog open onOpenChangeComplete={onOpenChangeComplete} />,
      { wrapper: MotionProvider }
    );
    expect(content()).not.toBeNull();

    rerender(
      <TestDialog open={false} onOpenChangeComplete={onOpenChangeComplete} />
    );

    await waitFor(() => {
      expect(content()).toBeNull();
      expect(overlay()).toBeNull();
    });
    expect(
      onOpenChangeComplete.mock.calls.filter(([open]) => !open)
    ).toHaveLength(1);
  });

  it("opens from its trigger and closes from its close button", async () => {
    const onOpenChangeComplete = mock<(open: boolean) => void>();
    render(
      <Dialog onOpenChangeComplete={onOpenChangeComplete}>
        <DialogTrigger asChild>
          <button type="button">Open</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete track</DialogTitle>
        </DialogContent>
      </Dialog>,
      { wrapper: MotionProvider }
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
    });
    expect(content()).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    await waitFor(() => expect(content()).toBeNull());
    await waitFor(() =>
      expect(onOpenChangeComplete).toHaveBeenCalledWith(false)
    );
    expect(
      onOpenChangeComplete.mock.calls.filter(([open]) => !open)
    ).toHaveLength(1);
  });
});
