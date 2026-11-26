import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

type Result = { data?: unknown; error?: unknown; response: Response };
type Request = (path: string, init: unknown) => Promise<Result>;
const GET = mock<Request>();
const PATCH = mock<Request>();
const PUT = mock<Request>();
const POST = mock<Request>();
mock.module("@/lib/browser-api", () => ({
  browserApi: { GET, PATCH, PUT, POST },
}));

const { MotionProvider } =
  await import("@workspace/ui/components/motion-provider");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("../hub-rows");
const { SettingGroupView } = await import("../SettingGroupView");
const { ResetGroupButton } = await import("./ResetGroupButton");
type HubRow = import("../types").HubRow;
type HubRows = import("../types").HubRows;
type HubGroupEntry = import("../layout").HubGroupEntry;

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

const EDITOR: HubGroupEntry = {
  kind: "group",
  id: "editor",
  label: "Editor",
  order: 50,
  rows: [
    { key: "editor.rhymePrefix", scope: "user" },
    { key: "editor.synonymPrefix", scope: "user" },
  ],
};

const own = (value: string): HubRow => ({
  effective: value,
  source: "user",
  writable: { user: true, instance: false },
  lockable: { user: false, instance: false },
  values: { user: value },
});

const inherited = (value: string): HubRow => ({
  effective: value,
  source: "default",
  writable: { user: true, instance: false },
  lockable: { user: false, instance: false },
  values: {},
});

function mount(rows: HubRows) {
  return render(
    <SettingsProvider initial={effectiveSettings({}, "v1")}>
      <HubRowsProvider initial={rows} projectId={null} userId="u1">
        <SettingGroupView
          group={EDITOR}
          action={<ResetGroupButton group={EDITOR} />}
        />
      </HubRowsProvider>
    </SettingsProvider>,
    { wrapper: MotionProvider }
  );
}

const resetButton = () =>
  screen.queryByRole("button", { name: "Reset all Editor settings" });

/** Opens the confirm (clearing `settings`, as it says) and presses Reset, then lets the write queue send. */
async function confirmReset(settings = "1 setting") {
  fireEvent.click(resetButton()!);
  const dialog = screen.getByRole("alertdialog", { name: "Reset Editor?" });
  expect(dialog.textContent).toContain(
    `Clears the ${settings} you set yourself`
  );
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
  });
  await act(async () => {
    await advanceTimersByTimeAsync(300);
  });
}

/** The body and target of the `index`th settings write. */
const written = (index = 0) =>
  PATCH.mock.calls[index]?.[1] as {
    params: { path: { scope: string; id: string } };
    body: Record<string, unknown>;
  };

beforeEach(() => {
  jest.useFakeTimers();
  for (const request of [GET, PATCH, PUT, POST]) request.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ResetGroupButton", () => {
  it("offers nothing while the group holds no value of the user's own", () => {
    mount({
      "editor.rhymePrefix": inherited("\\"),
      "editor.synonymPrefix": inherited("~"),
    });

    expect(resetButton()).toBeNull();
  });

  it("confirms, then clears every key of the group at user scope in one write", async () => {
    mount({
      "editor.rhymePrefix": own("!!"),
      "editor.synonymPrefix": inherited("~"),
    });
    PATCH.mockResolvedValue(
      ok({
        "editor.rhymePrefix": inherited("\\"),
        "editor.synonymPrefix": inherited("~"),
      })
    );

    await confirmReset();

    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(written().params.path).toEqual({ scope: "user", id: "u1" });
    expect(written().body).toEqual({
      "editor.rhymePrefix": null,
      "editor.synonymPrefix": null,
    });
    // The rows repaint from the server's answer, with no read of the page.
    expect(
      (screen.getByLabelText("Rhyme prefix") as HTMLInputElement).value
    ).toBe("\\");
    expect(GET).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(
      "Reset 1 Editor setting",
      undefined
    );
    // Nothing of the user's own is left, so neither is the button, and the
    // closing dialog hands focus to the group's first control.
    expect(resetButton()).toBeNull();
    await act(async () => {
      await advanceTimersByTimeAsync(1000);
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Rhyme prefix"));
  });

  it("clears the user's value under the instance's lock too, which lets a clearing write through", async () => {
    mount({
      "editor.rhymePrefix": own("!!"),
      "editor.synonymPrefix": {
        ...own("~~"),
        effective: "~",
        source: "instance",
        lockedBy: "instance",
        writable: { user: false, instance: false },
      },
    });
    PATCH.mockResolvedValue(
      ok({
        "editor.rhymePrefix": inherited("\\"),
        "editor.synonymPrefix": {
          ...inherited("~"),
          source: "instance",
          lockedBy: "instance",
          writable: { user: false, instance: false },
        },
      })
    );

    await confirmReset("2 settings");

    expect(written().body).toEqual({
      "editor.rhymePrefix": null,
      "editor.synonymPrefix": null,
    });
  });

  it("clears the user's value under a project's lock too, which refuses nothing at user scope", async () => {
    mount({
      "editor.rhymePrefix": {
        ...own("!!"),
        effective: "\\",
        source: "project",
        lockedBy: "project",
        writable: { user: false, project: false },
      },
      "editor.synonymPrefix": inherited("~"),
    });
    PATCH.mockResolvedValue(
      ok({
        "editor.rhymePrefix": inherited("\\"),
        "editor.synonymPrefix": inherited("~"),
      })
    );

    await confirmReset();

    expect(written().body).toEqual({
      "editor.rhymePrefix": null,
      "editor.synonymPrefix": null,
    });
  });

  it("says why when the server refuses, and reads the page again after a lock conflict", async () => {
    mount({
      "editor.rhymePrefix": own("!!"),
      "editor.synonymPrefix": inherited("~"),
    });
    PATCH.mockResolvedValue({
      error: {
        error: "Rhyme prefix is locked by the instance",
        code: "setting_locked",
      },
      response: new Response(null, { status: 409 }),
    });
    GET.mockResolvedValue(
      ok({
        "editor.rhymePrefix": { ...own("!!"), lockedBy: "instance" },
        "editor.synonymPrefix": inherited("~"),
      })
    );

    await confirmReset();

    expect(toastError).toHaveBeenCalledWith(
      "Rhyme prefix is locked by the instance"
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(GET.mock.calls[0]?.[0]).toBe("/api/settings");
  });
});
