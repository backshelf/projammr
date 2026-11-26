import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { ModalScopeProvider, type ModalSurface } from "../lib/modal-scope";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";

afterEach(cleanup);

describe("ConfirmDeleteDialog", () => {
  it("renders the confirm button as the destructive variant", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete track?"
        onConfirm={() => {}}
      />
    );

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    expect(confirmButton.className).toContain("text-destructive");
  });

  it("keeps Delete disabled until confirmText matches exactly", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete My Project?"
        confirmText="My Project"
        onConfirm={() => {}}
      />
    );

    const confirmButton = screen.getByRole("button", {
      name: "Delete",
    }) as HTMLButtonElement;
    const input = screen.getByLabelText("Type My Project to confirm");

    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "My Proj" } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "My Project" } });
    expect(confirmButton.disabled).toBe(false);
  });

  it("offers its confirm to the modal scope only while Delete is enabled", async () => {
    const surfaces: ModalSurface[] = [];
    const push = (surface: ModalSurface) => {
      surfaces.push(surface);
      return () => {};
    };
    const onConfirm = mock<() => void>();
    render(
      <ModalScopeProvider push={push}>
        <ConfirmDeleteDialog
          open
          onOpenChange={() => {}}
          title="Delete My Project?"
          confirmText="My Project"
          onConfirm={onConfirm}
        />
      </ModalScopeProvider>
    );

    // One push for the open dialog; its confirm follows the button's state.
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0]!;
    expect(surface.confirm).toBeUndefined();

    const input = screen.getByLabelText("Type My Project to confirm");
    fireEvent.change(input, { target: { value: "My Project" } });
    expect(surface.confirm).toBeDefined();

    await act(async () => {
      surface.confirm?.();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm once the typed text matches", async () => {
    const onConfirm = mock<() => void>();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete My Project?"
        confirmText="My Project"
        onConfirm={onConfirm}
      />
    );

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    fireEvent.change(screen.getByLabelText("Type My Project to confirm"), {
      target: { value: "My Project" },
    });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("has no confirmation input when confirmText is not given", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete comment?"
        onConfirm={() => {}}
      />
    );

    const confirmButton = screen.getByRole("button", {
      name: "Delete",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the content it is given between the description and the buttons", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete High?"
        description="3 tracks use High."
        onConfirm={() => {}}
      >
        <p>Move them to None</p>
      </ConfirmDeleteDialog>
    );

    const description = screen.getByText("3 tracks use High.");
    const content = screen.getByText("Move them to None");
    const confirmButton = screen.getByRole("button", { name: "Delete" });

    expect(
      description.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      content.compareDocumentPosition(confirmButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
