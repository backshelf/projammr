import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const leaveProject = mock();
const onOpenChange = mock();

mock.module("@/actions/members", () => ({ leaveProject }));

const { LeaveProjectDialog } = await import("./LeaveProjectDialog");

beforeEach(() => {
  for (const fn of [leaveProject, onOpenChange]) {
    fn.mockReset();
  }
});

afterEach(cleanup);

const renderDialog = () =>
  render(
    <LeaveProjectDialog
      projectId={7}
      projectName="Night Signals"
      open
      onOpenChange={onOpenChange}
    />
  );

const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: "Leave project" }));

describe("LeaveProjectDialog", () => {
  it("names the project it is about to leave", () => {
    renderDialog();

    expect(
      screen.getByRole("alertdialog", { name: "Leave Night Signals?" })
    ).toBeDefined();
  });

  it("leaves through the action, which redirects home on success", async () => {
    // A redirecting action never settles for its caller.
    leaveProject.mockReturnValue(new Promise(() => {}));
    renderDialog();

    confirm();

    await waitFor(() => expect(leaveProject).toHaveBeenCalledWith(7));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and shows the refusal when the caller is the last owner", async () => {
    leaveProject.mockResolvedValue({ error: "You're the only owner." });
    renderDialog();

    confirm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("You're the only owner.");
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
