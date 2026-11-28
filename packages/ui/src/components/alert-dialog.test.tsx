import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { MouseEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

const content = () =>
  document.querySelector<HTMLElement>('[data-slot="alert-dialog-content"]');

function renderAlert(onActionClick?: (event: MouseEvent) => void) {
  const onOpenChange = mock<(open: boolean) => void>();
  render(
    <AlertDialog defaultOpen onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete track?</AlertDialogTitle>
        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onActionClick}>
          Delete
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>,
    { wrapper: MotionProvider }
  );
  return { onOpenChange };
}

describe("AlertDialog", () => {
  it("renders open as an alert dialog named by its title", () => {
    renderAlert();

    expect(
      screen.getByRole("alertdialog", { name: "Delete track?" })
    ).toBeTruthy();
    expect(screen.getByText("Delete track?").className).toContain("font-sub");
    expect(screen.getByText("This cannot be undone.").className).toContain(
      "text-ink-soft"
    );
  });

  it("gives the action the variant it asks for", () => {
    renderAlert();

    expect(screen.getByRole("button", { name: "Delete" }).className).toContain(
      "text-destructive"
    );
  });

  it("closes and unmounts when the action is pressed", async () => {
    const { onOpenChange } = renderAlert();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    await waitFor(() => expect(content()).toBeNull());
  });

  it("stays open when the action's onClick prevents default", async () => {
    const { onOpenChange } = renderAlert((event) => event.preventDefault());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(content()).not.toBeNull();
  });

  it("closes from Cancel", async () => {
    renderAlert();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => expect(content()).toBeNull());
  });
});
