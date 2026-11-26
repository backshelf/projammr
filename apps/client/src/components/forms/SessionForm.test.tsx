import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const createSession = mock<
  (data: Record<string, unknown>) => Promise<{
    id: number;
    name: string;
    trackId: number | null;
  }>
>(async () => ({ id: 1, name: "Session", trackId: null }));
mock.module("@/actions/sessions", () => ({ createSession }));

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

const { SessionForm } = await import("./SessionForm");

afterEach(() => {
  cleanup();
  createSession.mockClear();
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

async function renderSessionForm() {
  await act(async () => {
    render(<SessionForm projectId={1} />);
  });
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
  });

describe("SessionForm", () => {
  it("shows 'Required' for a blank name and blocks submit", async () => {
    await renderSessionForm();
    await submit();

    expect(screen.getByText("Required")).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates without a main field in the payload", async () => {
    await renderSessionForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "ydkyb FINAL FINAL" },
    });
    await submit();

    expect(createSession).toHaveBeenCalledTimes(1);
    const payload = createSession.mock.calls[0]?.[0] ?? {};
    expect(payload).not.toHaveProperty("main");
    expect(payload).not.toHaveProperty("localFilepath");
  });
});
