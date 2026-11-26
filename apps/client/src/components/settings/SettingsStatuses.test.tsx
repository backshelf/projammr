import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { Status } from "@workspace/api/api";

type Written = Promise<{ ok: true }>;
const deleteStatus = mock<(id: number) => Written>(async () => ({ ok: true }));
const createStatus = mock<
  (data: { name: string; projectId: number }) => Written
>(async () => ({ ok: true }));
const updateStatus = mock<(id: number, data: { name?: string }) => Written>(
  async () => ({ ok: true })
);

mock.module("@/actions/statuses", () => ({
  createStatus,
  updateStatus,
  deleteStatus,
}));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { SettingsStatuses } = await import("./SettingsStatuses");

const status = (
  id: number,
  name: string,
  percentage: number,
  projectId: number | null = 7
): Status => ({
  id,
  name,
  description: "",
  percentage,
  // eslint-disable-next-line no-restricted-syntax -- a status's colour is a hex value in the payload
  colourHex: "#94A3B8",
  projectId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const statuses = [
  status(3, "Mixing", 70),
  status(1, "To Do", 0, null),
  status(2, "Sketch", 10),
];

const renderPane = async () => {
  await act(async () => {
    render(<SettingsStatuses projectId={7} statuses={statuses} />);
  });
};

afterEach(() => {
  cleanup();
  deleteStatus.mockClear();
  createStatus.mockClear();
  updateStatus.mockClear();
  mayEdit = true;
});

describe("SettingsStatuses", () => {
  it("lists statuses by completion, lowest first", async () => {
    await renderPane();

    const names = within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(names[0]).toContain("TO DO");
    expect(names[1]).toContain("SKETCH");
    expect(names[2]).toContain("MIXING");
  });

  it("gives an editor Add, a pencil per status, and a bin on the project's own", async () => {
    await renderPane();

    expect(screen.getByRole("button", { name: "Add status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit To Do" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Mixing" })).toBeTruthy();
  });

  it("has no bin on a shared status", async () => {
    await renderPane();

    expect(screen.queryByRole("button", { name: "Delete To Do" })).toBeNull();
  });

  it("shows a viewer the statuses and nothing to change them with", async () => {
    mayEdit = false;
    await renderPane();

    expect(screen.getByText("MIXING")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add status" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("asks before deleting a status, and deletes it once confirmed", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Delete Mixing" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete “Mixing”?")).toBeTruthy();
    expect(deleteStatus).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete status" })
      );
    });

    expect(deleteStatus).toHaveBeenCalledWith(3);
  });

  it("keeps the status when the confirm is cancelled", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Delete Mixing" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(deleteStatus).not.toHaveBeenCalled();
  });

  it("deletes a status straight away when status confirms are off", async () => {
    await act(async () => {
      render(
        <PoliciesProvider
          policies={{
            ...DEFAULT_POLICIES,
            feedback: {
              ...DEFAULT_POLICIES.feedback,
              confirmDeletes: {
                ...DEFAULT_POLICIES.feedback.confirmDeletes,
                status: false,
              },
            },
          }}
        >
          <SettingsStatuses projectId={7} statuses={statuses} />
        </PoliciesProvider>
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Mixing" }));
    });

    expect(deleteStatus).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("swaps a row for its form from the pencil and saves through updateStatus", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Edit Mixing" }));
    expect(screen.getByRole("form", { name: "Edit Mixing" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Mixing");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Mixdown" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus.mock.calls[0]?.[0]).toBe(3);
    expect(updateStatus.mock.calls[0]?.[1]).toMatchObject({ name: "Mixdown" });
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("closes an open edit form on cancel and on Escape", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Edit Mixing" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Mixing" }));
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("opens the add form on Add and creates the status in this project", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    expect(screen.getByRole("form", { name: "Add status" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Bounced" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(createStatus.mock.calls[0]?.[0]).toMatchObject({
      name: "Bounced",
      projectId: 7,
    });
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("keeps the add form open and says why when the name is empty", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("Name is required");
    expect(createStatus).not.toHaveBeenCalled();
  });
});
