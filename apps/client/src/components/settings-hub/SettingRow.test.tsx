import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import { z } from "zod";

/*
 * The registry gains fixtures shaped for these cases: `fixture.cascade`
 * (personal, user > project > instance, as a member default would be, which
 * no seed setting is), `fixture.restart` (a plain restart-required toggle) and
 * `fixture.custom` (a custom control nobody registered).
 */
const registry = await import("@workspace/settings");
const FIXTURE = {
  group: "fixture",
  description: "A setting declared by a test.",
  keywords: [],
  audience: "all",
} as const;
const cascade = registry.defineSetting({
  ...FIXTURE,
  key: "fixture.cascade",
  label: "Cascade",
  scopes: ["user", "project", "instance"],
  schema: z.string().min(1).max(4),
  default: "d",
  control: { kind: "text" },
});
const restart = registry.defineSetting({
  ...FIXTURE,
  key: "fixture.restart",
  label: "Restart",
  scopes: ["instance"],
  schema: z.boolean(),
  default: false,
  control: { kind: "toggle" },
  restartRequired: true,
});
const custom = registry.defineSetting({
  ...FIXTURE,
  key: "fixture.custom",
  label: "Custom",
  scopes: ["user"],
  schema: z.string(),
  default: "ctrl+k",
  control: { kind: "custom", component: "NobodyRegisteredThis" },
});
const SETTINGS = {
  ...registry.SETTINGS,
  [cascade.key]: cascade,
  [restart.key]: restart,
  [custom.key]: custom,
};
mock.module("@workspace/settings", () => ({
  ...registry,
  SETTINGS,
  isSettingKey: (key: string) => Object.hasOwn(SETTINGS, key),
}));

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
const PATCH = mock<(path: string, init: unknown) => Promise<Result>>();
const PUT = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { GET, PATCH, PUT } }));

const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("./hub-rows");
const { SettingRow } = await import("./SettingRow");
type HubRow = import("./types").HubRow;
type RegisteredSetting = import("@workspace/settings").RegisteredSetting;
type Scope = import("@/lib/settings/provider").SettingsWriteScope;

const CASCADE = cascade as unknown as RegisteredSetting;
const RESTART = restart as unknown as RegisteredSetting;
const CUSTOM = custom as unknown as RegisteredSetting;
const REGISTRATION = registry.SETTINGS["instance-access.registration"];

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

const refused = (status: number, error: string, code?: string): Result => ({
  error: { error, code },
  response: new Response(null, { status }),
});

const hubRow = (row: Partial<HubRow> = {}): HubRow => ({
  effective: "d",
  source: "default",
  writable: { user: true, instance: false },
  lockable: { user: false, instance: false },
  values: {},
  ...row,
});

function mount(
  row: HubRow,
  {
    definition = CASCADE,
    scope = "user",
    projectId = null,
  }: {
    definition?: RegisteredSetting;
    scope?: Scope;
    projectId?: number | null;
  } = {}
) {
  return render(
    <SettingsProvider initial={effectiveSettings({}, "v1")}>
      <HubRowsProvider
        initial={{ [definition.key]: row }}
        projectId={projectId}
        userId="u1"
      >
        <SettingRow definition={definition} scope={scope} anchored />
      </HubRowsProvider>
    </SettingsProvider>
  );
}

const input = () => screen.getByLabelText("Cascade") as HTMLInputElement;
const facts = () => document.getElementById(CASCADE.key)!.textContent ?? "";

/** The body of the `index`th request a mock received. */
const sent = (request: typeof PATCH, index = 0) =>
  request.mock.calls[index]?.[1] as {
    params: { path: { scope: string; id: string } };
    body: Record<string, unknown>;
  };

const settle = (ms = 300) =>
  act(async () => {
    await advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  GET.mockReset();
  PATCH.mockReset();
  PUT.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("SettingRow's source", () => {
  const cases: [HubRow["source"], string][] = [
    ["default", "Default"],
    ["env", "Environment"],
    ["instance", "Instance"],
    ["project", "Project"],
    ["user", "Yours"],
  ];

  for (const [source, word] of cases) {
    it(`reads "${word}" for a value from ${source}`, () => {
      mount(hubRow({ source, effective: "x" }));

      expect(facts()).toContain(word);
      expect(input().value).toBe("x");
    });
  }

  it("marks a value the row's own scope holds and offers a Reset", () => {
    mount(hubRow({ source: "user", effective: "x", values: { user: "x" } }));

    expect(screen.getByRole("button", { name: "Reset Cascade" })).toBeTruthy();
  });

  it("offers no Reset for a value it inherits", () => {
    mount(
      hubRow({ source: "instance", effective: "i", values: { instance: "i" } })
    );

    expect(screen.queryByRole("button", { name: "Reset Cascade" })).toBeNull();
  });
});

describe("SettingRow's changes", () => {
  it("shows a change at once, saves it once typing pauses, then says Saved", async () => {
    mount(hubRow());
    PATCH.mockResolvedValue(
      ok({
        [CASCADE.key]: hubRow({
          source: "user",
          effective: "ab",
          values: { user: "ab" },
        }),
      })
    );

    fireEvent.change(input(), { target: { value: "a" } });
    fireEvent.change(input(), { target: { value: "ab" } });
    expect(input().value).toBe("ab");
    expect(facts()).toContain("Saving");
    await settle(299);
    expect(PATCH).not.toHaveBeenCalled();

    await settle(1);
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(sent(PATCH).params.path).toEqual({ scope: "user", id: "u1" });
    expect(sent(PATCH).body).toEqual({ [CASCADE.key]: "ab" });
    expect(input().value).toBe("ab");
    expect(facts()).toContain("Saved");
    expect(facts()).toContain("Yours");
  });

  it("puts the saved value back and says why when the server refuses", async () => {
    mount(hubRow({ effective: "d" }));
    PATCH.mockResolvedValue(refused(400, "That value is not allowed"));

    fireEvent.change(input(), { target: { value: "zz" } });
    await settle();

    expect(input().value).toBe("d");
    expect(screen.getByRole("alert").textContent).toBe(
      "That value is not allowed"
    );
    expect(facts()).not.toContain("Saved");
  });

  it("re-reads the hub when a lock refused the change, and shows it", async () => {
    mount(hubRow());
    PATCH.mockResolvedValue(
      refused(409, "Locked by the instance", "setting_locked")
    );
    GET.mockResolvedValue(
      ok({
        [CASCADE.key]: hubRow({
          source: "instance",
          effective: "i",
          lockedBy: "instance",
          writable: { user: false, instance: false },
          values: { instance: "i" },
        }),
      })
    );

    fireEvent.change(input(), { target: { value: "zz" } });
    await settle();

    expect(GET.mock.calls[0]?.[0]).toBe("/api/settings");
    expect(input().value).toBe("i");
    expect(input().disabled).toBe(true);
    expect(facts()).toContain("Locked by instance");
  });

  it("never sends a value the schema refuses, and says why", async () => {
    mount(hubRow({ effective: "d" }));

    fireEvent.change(input(), { target: { value: "" } });
    await settle();

    expect(PATCH).not.toHaveBeenCalled();
    expect(input().value).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("Can't be empty");

    fireEvent.blur(input(), { relatedTarget: document.body });
    expect(input().value).toBe("d");
  });

  it("resets a personal value inside a project, then shows the project's", async () => {
    mount(
      hubRow({
        source: "user",
        effective: "u",
        writable: { user: true, project: false, instance: false },
        values: { user: "u", project: "p" },
      }),
      { projectId: 5 }
    );
    // The write is answered with no project in view; the page's own read
    // names project 5, so the row waits for that.
    PATCH.mockResolvedValue(
      ok({ [CASCADE.key]: hubRow({ source: "default", effective: "d" }) })
    );
    GET.mockResolvedValue(
      ok({
        [CASCADE.key]: hubRow({
          source: "project",
          effective: "p",
          writable: { user: true, project: false, instance: false },
          values: { project: "p" },
        }),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Cascade" }));
    await settle();

    expect(sent(PATCH).body).toEqual({ [CASCADE.key]: null });
    expect(GET.mock.calls[0]?.[1]).toEqual({
      params: { query: { project: "5" } },
    });
    expect(input().value).toBe("p");
    expect(facts()).toContain("Project");
    expect(screen.queryByRole("button", { name: "Reset Cascade" })).toBeNull();
  });
});

describe("SettingRow's locks", () => {
  it("disables a value an instance lock pins, and says who holds it", () => {
    mount(
      hubRow({
        source: "instance",
        effective: "i",
        lockedBy: "instance",
        writable: { user: false, instance: false },
        values: { user: "u", instance: "i" },
      })
    );

    expect(input().disabled).toBe(true);
    expect(input().value).toBe("i");
    expect(facts()).toContain("Locked by instance");
    expect(facts()).toContain("kept for when it unlocks");
    expect(screen.queryByRole("button", { name: "Reset Cascade" })).toBeNull();
  });

  it("disables a value its project locks, inside that project", () => {
    mount(
      hubRow({
        source: "project",
        effective: "p",
        lockedBy: "project",
        writable: { user: false, project: false, instance: false },
        values: { project: "p" },
      }),
      { projectId: 5 }
    );

    expect(input().disabled).toBe(true);
    expect(facts()).toContain("Locked by project");
  });

  it("shows a member default's own value rather than the caller's", () => {
    mount(
      hubRow({
        source: "user",
        effective: "u",
        writable: { user: true, instance: true },
        values: { user: "u", instance: "i" },
      }),
      { scope: "instance" }
    );

    expect(input().value).toBe("i");
    expect(facts()).toContain("Instance");
  });

  it("shows the default for a member default nobody has set", () => {
    mount(
      hubRow({
        source: "user",
        effective: "u",
        writable: { user: true, instance: true },
        values: { user: "u" },
      }),
      { scope: "instance" }
    );

    expect(input().value).toBe("d");
    expect(facts()).toContain("Default");
  });

  it("locks a member default for everyone, then re-reads the caller's settings", async () => {
    mount(
      hubRow({
        writable: { user: true, instance: true },
        lockable: { user: false, instance: true },
        values: {},
      }),
      { scope: "instance" }
    );
    PUT.mockResolvedValue(
      ok({
        [CASCADE.key]: hubRow({
          lockedBy: "instance",
          writable: { user: false, instance: true },
          values: { instance: "d" },
        }),
      })
    );
    GET.mockResolvedValue(ok({ values: {}, version: "v2" }));
    const toggle = screen.getByRole("button", {
      name: "Lock Cascade for every member",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await settle();

    expect(PUT.mock.calls[0]?.[0]).toBe("/api/settings/{scope}/{id}/locks");
    expect(sent(PUT)).toMatchObject({
      params: { path: { scope: "instance", id: "instance" } },
      body: { [CASCADE.key]: true },
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(GET.mock.calls[0]?.[0]).toBe("/api/settings/effective");
    expect(facts()).toContain("Saved");
  });

  it("shows a project owner the instance's lock and no lock of the project's own", () => {
    mount(
      hubRow({
        source: "instance",
        effective: "i",
        lockedBy: "instance",
        writable: { user: false, project: false, instance: false },
        values: { instance: "i" },
      }),
      { scope: "project", projectId: 5 }
    );

    expect(input().disabled).toBe(true);
    expect(facts()).toContain("Locked by instance");
    expect(screen.queryByRole("button", { name: /^Lock / })).toBeNull();
  });

  it("offers a project editor neither a lock nor a Reset on a value their project locks", () => {
    mount(
      hubRow({
        source: "project",
        effective: "p",
        lockedBy: "project",
        writable: { user: true, project: true, instance: false },
        lockable: { user: false, project: false, instance: false },
        values: { project: "p" },
      }),
      { scope: "project", projectId: 5 }
    );

    expect(screen.queryByRole("button", { name: /^Lock / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset Cascade" })).toBeNull();
  });

  it("offers a project admin the lock and the Reset on a value their project locks", () => {
    mount(
      hubRow({
        source: "project",
        effective: "p",
        lockedBy: "project",
        writable: { user: true, project: true, instance: false },
        lockable: { user: false, project: true, instance: false },
        values: { project: "p" },
      }),
      { scope: "project", projectId: 5 }
    );

    expect(screen.getByRole("button", { name: /^Lock / })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Cascade" })).toBeTruthy();
  });

  it("offers no lock on a key declared unlockable", () => {
    mount(
      hubRow({
        source: "instance",
        effective: "open",
        writable: { instance: true },
        values: { instance: "open" },
      }),
      { definition: REGISTRATION, scope: "instance" }
    );

    expect(screen.queryByRole("button", { name: /^Lock / })).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});

describe("SettingRow's other states", () => {
  it("renders read only, with its source, for a caller who may not write it", () => {
    mount(
      hubRow({
        source: "project",
        effective: "p",
        writable: { user: true, project: false, instance: false },
        values: { project: "p" },
      }),
      { scope: "project", projectId: 5 }
    );

    expect(input().disabled).toBe(true);
    expect(facts()).toContain("View only");
    expect(facts()).toContain("Project");
    expect(screen.queryByRole("button", { name: "Reset Cascade" })).toBeNull();
  });

  it("says a setting the server reads at startup applies after a restart", () => {
    mount(
      hubRow({
        source: "default",
        effective: false,
        writable: { instance: true },
      }),
      { definition: RESTART, scope: "instance" }
    );

    expect(document.getElementById(RESTART.key)!.textContent).toContain(
      "Applies after restart"
    );
  });

  it("says a restart-required setting is applied while the server runs with its value", () => {
    mount(
      hubRow({
        source: "instance",
        effective: false,
        running: false,
        writable: { instance: true },
        values: { instance: false },
      }),
      { definition: RESTART, scope: "instance" }
    );

    const text = document.getElementById(RESTART.key)!.textContent;
    expect(text).toContain("Applied");
    expect(text).not.toContain("Restart to apply");
  });

  it("says a restart-required setting waits on a restart once it differs from the running value", () => {
    mount(
      hubRow({
        source: "instance",
        effective: true,
        running: false,
        writable: { instance: true },
        values: { instance: true },
      }),
      { definition: RESTART, scope: "instance" }
    );

    expect(document.getElementById(RESTART.key)!.textContent).toContain(
      "Restart to apply"
    );
  });

  it("says the deployment keeps a restart-required setting off, instead of applied or waiting on a restart", () => {
    mount(
      hubRow({
        source: "instance",
        effective: true,
        running: false,
        deploymentOff: true,
        writable: { instance: true },
        values: { instance: true },
      }),
      { definition: RESTART, scope: "instance" }
    );

    const text = document.getElementById(RESTART.key)!.textContent;
    expect(text).toContain("Off: this deployment keeps it off");
    expect(text).not.toContain("Applied");
    expect(text).not.toContain("Restart to apply");
  });

  it("shows a custom control nobody registered read only, and says so while developing", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    mount(
      hubRow({
        source: "user",
        effective: "ctrl+j",
        writable: { user: true },
        values: { user: "ctrl+j" },
      }),
      { definition: CUSTOM }
    );

    expect(screen.getByLabelText("Custom").textContent).toBe("ctrl+j");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("NobodyRegisteredThis");
    error.mockRestore();
  });

  it("renders nothing for a setting the caller does not receive", () => {
    render(
      <SettingsProvider initial={effectiveSettings({}, "v1")}>
        <HubRowsProvider initial={{}} projectId={null} userId="u1">
          <SettingRow definition={CASCADE} scope="user" anchored />
        </HubRowsProvider>
      </SettingsProvider>
    );

    expect(document.getElementById(CASCADE.key)).toBeNull();
  });
});
