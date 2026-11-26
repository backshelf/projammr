import { afterEach, describe, expect, test } from "bun:test";
import { act, fireEvent, screen } from "@testing-library/react";

import type { PendingRestore, RestoreState } from "../ipc";
import {
  argsOf,
  mockApp,
  renderScreen,
  signedIn,
  teardown,
  type Call,
} from "../test-support";
import { Restore } from "./restore";

afterEach(teardown);

const ready: PendingRestore = {
  commitId: 4412,
  message: "added strings",
  set: "science",
  branch: "restore-a1b2c3d",
  problem: null,
};

const idle: RestoreState = { state: "idle" };

/** The core's refusal for a name it cannot use, as the app passes it on. */
const refusal = (name: string): string =>
  `\`${name}\` is not a usable branch name`;

function show(
  pending: PendingRestore,
  restore: RestoreState,
  answer?: (command: string, args: unknown) => unknown,
  liveOpen: string | null = null
): Call[] {
  const calls = mockApp(signedIn(), answer);
  renderScreen(
    <Restore pending={pending} restore={restore} liveOpen={liveOpen} />
  );
  return calls;
}

const field = (): HTMLInputElement =>
  screen.getByRole("textbox", { name: "Branch name" });

/**
 * The text of every alert on screen. Asserting on text, not on the element, keeps a failed expectation from
 * serializing a happy-dom node, which walks its whole window and takes seconds.
 */
const alerts = (): (string | null)[] =>
  screen.queryAllByRole("alert").map((alert) => alert.textContent);

/**
 * Lets the mocked app's answers reach the screen: the IPC call, the promise chain behind it and the state it
 * sets all settle inside one `act` before the next assertion, with no clock involved.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

describe("ready", () => {
  test("names the commit and the set, and starts on the branch the app suggests", () => {
    show(ready, idle);

    expect(
      screen.getByRole("heading", {
        name: "Restore 'added strings' as a new branch",
      })
    ).toBeTruthy();
    expect(screen.getByText("In science.")).toBeTruthy();
    expect(field().value).toBe("restore-a1b2c3d");
    expect(
      screen.getByRole("button", { name: "Restore and open" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  test("says what it can while the hub has not answered, and waits to restore", () => {
    show({ ...ready, message: null, set: null, branch: null }, idle);

    expect(
      screen.getByRole("heading", {
        name: "Restore this commit as a new branch",
      })
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Restore and open",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  test("restores with the commit and the name in the field", async () => {
    const calls = show(ready, idle);

    fireEvent.change(field(), { target: { value: "strings-take-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore and open" }));

    await settle();
    expect(argsOf(calls, "restore")).toEqual([
      { commitId: 4412, name: "strings-take-2" },
    ]);
  });

  test("asks the app about each edit and shows its refusal until the name is fine", async () => {
    show(ready, idle, (command, args) => {
      if (command === "validate_branch_name") {
        const { name } = args as { name: string };
        if (name.includes("/")) throw refusal(name);
      }
    });

    fireEvent.change(field(), { target: { value: "x/y" } });
    await settle();
    expect(alerts()).toEqual([refusal("x/y")]);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(
      (
        screen.getByRole("button", {
          name: "Restore and open",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    fireEvent.change(field(), { target: { value: "x-y" } });
    await settle();
    expect(alerts()).toEqual([]);
    expect(
      (
        screen.getByRole("button", {
          name: "Restore and open",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  test("lets only the latest answer decide when an earlier one comes back late", async () => {
    const waiting = new Map<string, () => void>();
    show(ready, idle, (command, args) => {
      if (command !== "validate_branch_name") return undefined;
      const { name } = args as { name: string };
      if (name !== "bad/") return undefined;
      return new Promise<void>((_, reject) => {
        waiting.set(name, () => reject(refusal(name)));
      });
    });

    fireEvent.change(field(), { target: { value: "bad/" } });
    fireEvent.change(field(), { target: { value: "good" } });
    await settle();
    waiting.get("bad/")?.();
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("keeps the app's refusal of the restore itself under the field", async () => {
    show(ready, idle, (command) => {
      if (command === "restore") throw refusal("restore-a1b2c3d");
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore and open" }));

    await settle();
    expect(alerts()).toEqual([refusal("restore-a1b2c3d")]);
  });

  test("Cancel lets go of the link", async () => {
    const calls = show(ready, idle);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await settle();
    expect(argsOf(calls, "cancel_restore")).toHaveLength(1);
  });
});

describe("the restore running", () => {
  test("fetching says so, counts what has come, and shows no form", () => {
    show(ready, { state: "fetching", objects: 12 });

    expect(screen.getByRole("status").textContent).toBe(
      "Fetching the commit\u2026 12 objects"
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore and open" })
    ).toBeNull();
  });

  test("fetching with nothing yet is just the line", () => {
    show(ready, { state: "fetching", objects: 0 });

    expect(screen.getByRole("status").textContent).toBe(
      "Fetching the commit\u2026"
    );
  });

  test("writing names the file", () => {
    show(ready, { state: "writing", file: "science @restore-a1b2.als" });

    expect(screen.getByRole("status").textContent).toBe(
      "Writing science @restore-a1b2.als\u2026"
    );
  });

  test("says a restore cannot be stopped, and Close keeps it going", async () => {
    const calls = show(ready, {
      state: "writing",
      file: "science @restore-a1b2.als",
    });

    expect(
      screen.getByText(/can't be stopped once it has started/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await settle();
    expect(argsOf(calls, "cancel_restore")).toHaveLength(1);
  });
});

describe("the restore finished", () => {
  test("opened says Opened in Live and names the file; Done lets go of the link", async () => {
    const calls = show(ready, {
      state: "opened",
      file: "science @restore-a1b2.als",
      note: null,
    });

    expect(screen.getByText("Opened in Live")).toBeTruthy();
    expect(screen.getByText("science @restore-a1b2.als")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await settle();
    expect(argsOf(calls, "cancel_restore")).toHaveLength(1);
  });

  test("written but not opened says why", () => {
    show(ready, {
      state: "opened",
      file: "science @restore-a1b2.als",
      note: "Live wasn't found.",
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Restored science @restore-a1b2.als"
    );
    expect(screen.getByText("Live wasn't found.")).toBeTruthy();
    expect(screen.queryByText("Opened in Live")).toBeNull();
  });

  test("failed gives the core's reason and keeps the form for another try", async () => {
    const calls = show(ready, {
      state: "failed",
      message: "The hub could not be asked.",
      suggestion: null,
      existing: null,
    });

    await settle();
    expect(alerts()).toEqual(["The hub could not be asked."]);
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    fireEvent.change(field(), { target: { value: "restore-two" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore and open" }));
    await settle();
    expect(argsOf(calls, "restore")).toEqual([
      { commitId: 4412, name: "restore-two" },
    ]);
  });

  const inTheWay = {
    state: "failed",
    message:
      "/Users/me/Music/science Project/science @restore-a1b2c3d.als already exists. Try the name restore-a1b2c3d-2.",
    suggestion: "restore-a1b2c3d-2",
    existing: "/Users/me/Music/science Project/science @restore-a1b2c3d.als",
  } satisfies RestoreState;

  test("an existing file offers the free name, which refills the field and is checked like an edit", async () => {
    const calls = show(ready, inTheWay);

    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Use restore-a1b2c3d-2" })
    );

    expect(field().value).toBe("restore-a1b2c3d-2");
    await settle();
    expect(argsOf(calls, "validate_branch_name")).toEqual([
      { name: "restore-a1b2c3d-2" },
    ]);
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore and open" }));
    await settle();
    expect(argsOf(calls, "restore")).toEqual([
      { commitId: 4412, name: "restore-a1b2c3d-2" },
    ]);
  });

  test("an existing file that is not the open set says what the core said", async () => {
    show(
      ready,
      inTheWay,
      undefined,
      "/Users/me/Music/science Project/science.als"
    );

    await settle();
    expect(alerts().join(" ")).toContain("already exists");
    expect(screen.queryByText(/^Live has/)).toBeNull();
  });

  test("an existing file that Live has open says so and offers the other name", async () => {
    show(
      ready,
      inTheWay,
      undefined,
      "/Users/me/Music/science Project/science @restore-a1b2c3d.als"
    );

    await settle();
    expect(alerts()).toEqual([
      "Live has science @restore-a1b2c3d.als open. Restore under another name.",
    ]);
    expect(
      screen.getByRole("button", { name: "Use restore-a1b2c3d-2" })
    ).toBeTruthy();
  });
});

describe("a link the app cannot use", () => {
  test("shows the reason and only a way out", async () => {
    const calls = show(
      {
        commitId: 9,
        message: null,
        set: null,
        branch: null,
        problem: "Not tracked by dit on this computer.",
      },
      idle
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Not tracked by dit on this computer."
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await settle();
    expect(argsOf(calls, "cancel_restore")).toHaveLength(1);
  });
});
