import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Label } from "@workspace/api/api";

const deleteLabel = mock(async () => ({ ok: true as const }));
const createLabel = mock<
  (
    projectId: number,
    data: { name: string; colourHex?: string }
  ) => Promise<{ ok: true }>
>(async () => ({ ok: true }));

mock.module("@/actions/labels", () => ({
  createLabel,
  updateLabel: mock(),
  deleteLabel,
}));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { SettingsLabels } = await import("./SettingsLabels");

const label = (id: number, name: string): Label => ({
  id,
  name,
  // eslint-disable-next-line no-restricted-syntax -- a label's colour is a hex value in the payload
  colourHex: "#94A3B8",
  projectId: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const labels = [label(1, "needs vocals"), label(2, "mix ready")];

afterEach(() => {
  cleanup();
  deleteLabel.mockClear();
  createLabel.mockClear();
  mayEdit = true;
});

describe("SettingsLabels", () => {
  it("gives an editor an Add control and edit and delete buttons per label", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    expect(screen.getByRole("button", { name: "Add label" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit needs vocals" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete mix ready" })
    ).toBeTruthy();
  });

  it("shows a viewer the labels and nothing to change them with", async () => {
    mayEdit = false;
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    expect(screen.getByText("needs vocals")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add label" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("asks before deleting and says where the label comes off", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Delete needs vocals" })
    );
    expect(deleteLabel).not.toHaveBeenCalled();
    expect(
      screen.getByText(/comes off every track, collection and session/)
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete label" }));
    });
    expect(deleteLabel).toHaveBeenCalledWith(7, 1);
  });

  it("swaps a row for its form from the pencil and closes it on cancel", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit mix ready" }));
    expect(screen.getByRole("form", { name: "Edit mix ready" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "mix ready");
    expect(screen.queryByRole("button", { name: "Edit mix ready" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit mix ready" })).toBeTruthy();
  });

  it("hands focus back to the control that opened a form once it closes", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit mix ready" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit mix ready" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add label" })
    );
  });

  it("closes an open edit form on Escape", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit mix ready" }));
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });

    expect(screen.queryByRole("form")).toBeNull();
  });

  it("opens the add form in place at the top of the list and saves through createLabel", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    const form = screen.getByRole("form", { name: "Add label" });
    expect(form).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "live set" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(createLabel).toHaveBeenCalledWith(7, { name: "live set" });
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("keeps the add form open and says why when the name is empty", async () => {
    await act(async () => {
      render(<SettingsLabels projectId={7} labels={labels} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("Name is required");
    expect(createLabel).not.toHaveBeenCalled();
  });
});
