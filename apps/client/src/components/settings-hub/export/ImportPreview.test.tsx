import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

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
const { defaultFormatters } = await import("@workspace/ui/lib/formatters");
const { HubRowsProvider } = await import("../hub-rows");
const { ImportFlow } = await import("./ImportFlow");
type HubRows = import("../types").HubRows;

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

const refused = (
  status: number,
  error: string,
  details?: Record<string, unknown>
): Result => ({
  error: { error, code: "invalid_request", details },
  response: new Response(null, { status }),
});

/** A promise and the function that settles it, for an answer the test holds back. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const ROWS: HubRows = {
  "editor.rhymePrefix": {
    effective: "\\",
    source: "default",
    writable: { user: true },
    lockable: { user: false },
    values: {},
  },
  "editor.synonymPrefix": {
    effective: "~",
    source: "user",
    writable: { user: true },
    lockable: { user: false },
    values: { user: "~" },
  },
};

const FILE = {
  version: 1,
  exportedAt: "2026-09-20T10:00:00.000Z",
  values: {
    "editor.rhymePrefix": "!!",
    "editor.synonymPrefix": "~",
    "player.gone": 3,
    "instance-access.registration": "closed",
  },
};

const DRY_RUN = {
  applied: ["editor.rhymePrefix", "editor.synonymPrefix"],
  skipped: [
    { key: "player.gone", reason: "unknown" },
    { key: "instance-access.registration", reason: "scope" },
  ],
};

/** Every read the page makes after an import: the hub's rows and the effective settings. */
const reads = () => GET.mock.calls.map(([path]) => path);

/** The body and query of the `index`th import request. */
const imported = (index: number) =>
  POST.mock.calls[index]?.[1] as {
    params: { path: { id: string }; query: Record<string, string> };
    body: unknown;
  };

function mount() {
  render(
    <SettingsProvider initial={effectiveSettings({}, "v1")}>
      <HubRowsProvider initial={ROWS} projectId={null} userId="u1">
        <ImportFlow />
      </HubRowsProvider>
    </SettingsProvider>,
    { wrapper: MotionProvider }
  );
}

/** Whether the import's dialog is on the page; a boolean, so a failure does not print the DOM. */
const dialogShown = () =>
  document.querySelector('[data-slot="alert-dialog-content"]') !== null;

function choose(contents: string, name = "projammr-settings-2026-09-20.json") {
  fireEvent.change(screen.getByLabelText("Settings file to import"), {
    target: { files: [new File([contents], name)] },
  });
}

const dialog = () => screen.getByRole("alertdialog");
const button = (name: string) => within(dialog()).getByRole("button", { name });

beforeEach(() => {
  for (const request of [GET, PATCH, PUT, POST]) request.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  GET.mockImplementation(async (path) =>
    path === "/api/settings" ? ok(ROWS) : ok({ values: {}, version: "v2" })
  );
});

afterEach(cleanup);

describe("ImportFlow's preview", () => {
  it("lists what a dry run would change, what already matches and what it skips", async () => {
    POST.mockResolvedValue(ok(DRY_RUN));
    mount();

    choose(JSON.stringify(FILE));

    const changes = await screen.findByRole("region", { name: "Changes" });
    expect(imported(0).params).toEqual({
      path: { id: "u1" },
      query: { dryRun: "true" },
    });
    expect(imported(0).body).toEqual(FILE);
    expect(changes.textContent).toContain("Rhyme prefix");
    expect(changes.textContent).toContain("“\\” → to “!!”");
    expect(
      screen.getByRole("region", { name: "Already the same" }).textContent
    ).toContain("Synonym prefix");
    const skipped = screen.getByRole("region", { name: "Skipped" });
    expect(skipped.textContent).toContain("player.gone");
    expect(skipped.textContent).toContain("unknown setting");
    expect(skipped.textContent).toContain("Registration");
    expect(skipped.textContent).toContain("not a personal setting");
    expect(button("Import 2 settings")).toBeTruthy();
    expect(dialog().textContent).toContain(
      `From projammr-settings-2026-09-20.json, exported ${defaultFormatters().date(FILE.exportedAt)}. Nothing changes until you import.`
    );
  });

  it("reads a key locked at instance scope as skipped, locked by instance", async () => {
    POST.mockResolvedValue(
      ok({
        applied: [],
        skipped: [{ key: "editor.rhymePrefix", reason: "locked" }],
      })
    );
    mount();

    choose(JSON.stringify(FILE));

    const skipped = await screen.findByRole("region", { name: "Skipped" });
    expect(skipped.textContent).toContain("locked by instance");
    expect(dialog().textContent).toContain(
      "Nothing in this file can be imported here."
    );
    expect(within(dialog()).queryByRole("button", { name: /^Import/ })).toBe(
      null
    );
  });
});

describe("ImportFlow's apply", () => {
  it("imports for real, brings the page's rows and settings up to date, then toasts the counts", async () => {
    POST.mockResolvedValueOnce(ok(DRY_RUN)).mockResolvedValueOnce(ok(DRY_RUN));
    const hubRead = deferred<Result>();
    GET.mockImplementation((path) =>
      path === "/api/settings"
        ? hubRead.promise
        : Promise.resolve(ok({ values: {}, version: "v2" }))
    );
    mount();
    choose(JSON.stringify(FILE));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 2 settings" })
    );

    await waitFor(() => expect(POST).toHaveBeenCalledTimes(2));
    expect(imported(1).params.query).toEqual({});
    expect(imported(1).body).toEqual(FILE);
    await waitFor(() => expect(reads()).toContain("/api/settings/effective"));
    // The rows have not been read again yet, so nothing is announced.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(button("Importing…").hasAttribute("disabled")).toBe(true);

    hubRead.resolve(ok(ROWS));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Imported 2 settings, skipped 2",
        undefined
      )
    );
    await waitFor(() => expect(dialogShown()).toBe(false));
  });

  it("says nothing was imported when the server refuses, and applies again on Try again", async () => {
    POST.mockResolvedValueOnce(ok(DRY_RUN))
      .mockResolvedValueOnce({
        error: { error: "Couldn't import your settings" },
        response: new Response(null, { status: 500 }),
      })
      .mockResolvedValueOnce(ok(DRY_RUN));
    mount();
    choose(JSON.stringify(FILE));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 2 settings" })
    );

    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).toBe(
      "Nothing was imported. Couldn't import your settings"
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // The server answered, so nothing changed: the page is not read again.
    expect(reads()).toEqual([]);

    fireEvent.click(button("Try again"));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Imported 2 settings, skipped 2",
        undefined
      )
    );
    expect(POST).toHaveBeenCalledTimes(3);
  });

  it("reads the page again when the server never answered, since the import may have landed", async () => {
    POST.mockResolvedValueOnce(ok(DRY_RUN)).mockRejectedValueOnce(
      new Error("Network error")
    );
    mount();
    choose(JSON.stringify(FILE));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 2 settings" })
    );

    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).toContain(
      "Network error: the import may or may not have gone through"
    );
    expect(reads()).toContain("/api/settings");
    expect(reads()).toContain("/api/settings/effective");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(button("Try again")).toBeTruthy();
  });

  it("shows what the import did differently when a lock landed after the preview", async () => {
    POST.mockResolvedValueOnce(ok(DRY_RUN)).mockResolvedValueOnce(
      ok({
        applied: ["editor.synonymPrefix"],
        skipped: [
          ...DRY_RUN.skipped,
          { key: "editor.rhymePrefix", reason: "locked" },
        ],
      })
    );
    mount();
    choose(JSON.stringify(FILE));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 2 settings" })
    );

    const dropped = await screen.findByRole("region", {
      name: "Skipped after all",
    });
    expect(dropped.textContent).toContain("Rhyme prefix");
    expect(dropped.textContent).toContain("locked by instance");
    expect(dialog().textContent).toContain("Imported 1 setting.");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Imported 1 setting, skipped 3",
      undefined
    );

    fireEvent.click(button("Done"));
    await waitFor(() => expect(dialogShown()).toBe(false));
  });
});

describe("ImportFlow's refusals", () => {
  it("refuses a file that is not JSON without asking the server", async () => {
    mount();

    choose("not json at all");

    const alert = await within(
      await screen.findByRole("alertdialog")
    ).findByRole("alert");
    expect(alert.textContent).toContain("This file isn't JSON");
    expect(POST).not.toHaveBeenCalled();
    expect(button("Choose another file")).toBeTruthy();
  });

  it("names the format of an export this instance does not read", async () => {
    POST.mockResolvedValue(
      refused(400, "Invalid request", {
        issues: [{ path: ["version"], message: "Invalid input" }],
      })
    );
    mount();

    choose(JSON.stringify({ ...FILE, version: 2 }));

    const alert = await within(
      await screen.findByRole("alertdialog")
    ).findByRole("alert");
    expect(alert.textContent).toBe(
      "This export is in a format this instance doesn't read (version 2)."
    );
  });

  it("refuses JSON that is not an export", async () => {
    POST.mockResolvedValue(
      refused(400, "Invalid request", {
        issues: [{ path: ["values"], message: "Required" }],
      })
    );
    mount();

    choose(JSON.stringify({ theme: "dark" }));

    const alert = await within(
      await screen.findByRole("alertdialog")
    ).findByRole("alert");
    expect(alert.textContent).toBe(
      "This file isn't a Projammr settings export."
    );
  });

  it("asks for the dry run again after one that failed", async () => {
    POST.mockResolvedValueOnce({
      error: { error: "Service unavailable" },
      response: new Response(null, { status: 503 }),
    }).mockResolvedValueOnce(ok(DRY_RUN));
    mount();
    choose(JSON.stringify(FILE));

    const alert = await within(
      await screen.findByRole("alertdialog")
    ).findByRole("alert");
    expect(alert.textContent).toBe("Service unavailable");

    fireEvent.click(button("Try again"));

    expect(await screen.findByRole("region", { name: "Changes" })).toBeTruthy();
    expect(imported(1).params.query).toEqual({ dryRun: "true" });
  });

  it("drops a dry run's answer once the dialog was closed", async () => {
    const answer = deferred<Result>();
    POST.mockReturnValue(answer.promise);
    mount();
    choose(JSON.stringify(FILE));
    await waitFor(() => expect(POST).toHaveBeenCalled());

    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(dialogShown()).toBe(false));
    answer.resolve(ok(DRY_RUN));
    await answer.promise;

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dialogShown()).toBe(false);
  });
});
