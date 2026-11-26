import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const createProject = mock(async () => ({ id: 1, name: "Project" }));
mock.module("@/actions/projects", () => ({ createProject }));

const push = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// The block editor only mounts once hydrated; keeping it unhydrated in tests
// avoids pulling BlockNote's browser-only editor into happy-dom.
mock.module("@workspace/ui/hooks/use-hydrated", () => ({
  useHydrated: () => false,
}));

const { ProjectForm } = await import("./ProjectForm");

afterEach(() => {
  cleanup();
  createProject.mockClear();
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

async function renderProjectForm() {
  await act(async () => {
    render(<ProjectForm />);
  });
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  });

describe("ProjectForm", () => {
  it("shows 'Required' for a blank name and blocks submit", async () => {
    await renderProjectForm();
    await submit();

    expect(screen.getByText("Required")).toBeTruthy();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows 'Name this link' for a blank link name and blocks submit", async () => {
    await renderProjectForm();

    fireEvent.change(screen.getByLabelText("Name (required)"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });
    await submit();

    expect(screen.getByText("Name this link")).toBeTruthy();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows 'Enter a valid URL, including https://' for a bad link URL", async () => {
    await renderProjectForm();

    fireEvent.change(screen.getByLabelText("Name (required)"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Website" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "not-a-url" },
    });
    await submit();

    expect(
      screen.getByText("Enter a valid URL, including https://")
    ).toBeTruthy();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("submits the links it validated", async () => {
    await renderProjectForm();

    fireEvent.change(screen.getByLabelText("Name (required)"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Website" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });
    await submit();

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Project",
        links: [{ name: "Website", url: "https://example.com" }],
      })
    );
  });
});
