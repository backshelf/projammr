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

type Result = { data?: unknown; error?: unknown; response: Response };
const PATCH = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({
  browserApi: { GET: mock(), PATCH, PUT: mock() },
}));

const { SETTINGS } = await import("@workspace/settings");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("./hub-rows");
const { hubLayout } = await import("./layout");
const { SettingGroupView } = await import("./SettingGroupView");
const { ResetGroupButton } = await import("./export/ResetGroupButton");
type HubRow = import("./types").HubRow;
type HubRows = import("./types").HubRows;
type SettingKey = import("@workspace/settings").SettingKey;
type HubGroupEntry = import("./layout").HubGroupEntry;

const instance = hubLayout({
  visible: new Set(Object.keys(SETTINGS)),
  isAdmin: true,
  project: null,
  panes: [],
}).sections.find(({ id }) => id === "instance")!;

const entry = instance.entries.find(({ id }) => id === "instance-rate-limits")!;
if (entry.kind !== "group") throw new Error("Rate limits is a group");
const rateLimits: HubGroupEntry = entry;
const KEYS = rateLimits.rows.map(({ key }) => key);

const SIGN_IN = "instance-rate-limits.auth-signin.burst";

const atDefault = (key: SettingKey): HubRow => ({
  effective: SETTINGS[key].default,
  source: "default",
  writable: { instance: true },
  lockable: { instance: true },
  values: {},
});

const everyDefault = (): HubRows =>
  Object.fromEntries(KEYS.map((key) => [key, atDefault(key)]));

function mount(rows: HubRows, opened = false) {
  return render(
    <SettingsProvider initial={effectiveSettings({}, "v1")}>
      <HubRowsProvider initial={rows} projectId={null} userId="u1">
        <SettingGroupView
          group={rateLimits}
          action={<ResetGroupButton group={rateLimits} />}
          opened={opened}
        />
      </HubRowsProvider>
    </SettingsProvider>
  );
}

const row = (key: string) => document.getElementById(key);

const resetButton = () =>
  screen.queryByRole("button", { name: "Reset all Rate limits settings" });

beforeEach(() => {
  jest.useFakeTimers();
  PATCH.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("an advanced group", () => {
  it("folds under its head, with its count, until it is opened", () => {
    mount(everyDefault());

    // The count sits apart from the title in the head's name.
    const head = screen.getByRole("button", {
      name: new RegExp(`^Rate limits\\W+${KEYS.length}$`),
    });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(row(SIGN_IN)).toBeNull();

    fireEvent.click(head);

    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(row(SIGN_IN)).not.toBeNull();
  });

  it("opens from the start when the page's URL names it", () => {
    mount(everyDefault(), true);

    expect(row(SIGN_IN)).not.toBeNull();
    // Every row is at its default, so there is nothing to reset.
    expect(resetButton()).toBeNull();
  });

  it("resets every row in one write of nulls from its folded head, once confirmed", async () => {
    mount({
      ...everyDefault(),
      [SIGN_IN]: {
        effective: 4,
        source: "instance",
        writable: { instance: true },
        lockable: { instance: true },
        values: { instance: 4 },
      },
    });
    PATCH.mockResolvedValue({
      data: { [SIGN_IN]: atDefault(SIGN_IN) },
      response: new Response(null, { status: 200 }),
    });
    expect(row(SIGN_IN)).toBeNull();

    fireEvent.click(resetButton()!);
    const dialog = screen.getByRole("alertdialog", {
      name: "Reset Rate limits?",
    });
    expect(dialog.textContent).toContain(
      "Clears the 1 setting stored for this instance"
    );
    expect(PATCH).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    });
    await act(async () => {
      await advanceTimersByTimeAsync(300);
    });

    expect(PATCH).toHaveBeenCalledTimes(1);
    const { params, body } = PATCH.mock.calls[0]![1] as {
      params: { path: { scope: string; id: string } };
      body: Record<string, unknown>;
    };
    expect(params.path).toEqual({ scope: "instance", id: "instance" });
    expect(body).toEqual(Object.fromEntries(KEYS.map((key) => [key, null])));
    expect(resetButton()).toBeNull();
  });
});
