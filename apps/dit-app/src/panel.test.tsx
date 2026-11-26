import { afterEach, describe, expect, test } from "bun:test";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { emit, TauriEvent } from "@tauri-apps/api/event";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import { STATE_EVENT } from "./ipc";
import { Panel } from "./panel";
import { card } from "./renders/test-cards";
import {
  argsOf,
  base,
  mockApp,
  signedIn,
  snapshotWith,
  teardown,
} from "./test-support";

afterEach(teardown);

function showPanel(): void {
  render(
    <MotionProvider>
      <Panel />
    </MotionProvider>
  );
}

async function openMenuItem(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) })
  );
}

describe("Panel", () => {
  test("waits for the app's first snapshot", () => {
    mockApp(base);
    showPanel();

    expect(screen.getByText("Waiting for the app…")).toBeTruthy();
  });

  test("shows the code of a sign-in in progress", async () => {
    mockApp(base);
    showPanel();

    expect(await screen.findByText("WDJB-MJHT")).toBeTruthy();
  });

  test("offers sign-in when signed out", async () => {
    mockApp(
      snapshotWith({ auth: { state: "signed-out", host: null, pending: null } })
    );
    showPanel();

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("asks for another machine name when the hub refused this one", async () => {
    mockApp(signedIn({ machine: { name: null, refused: "Studio Mac" } }));
    showPanel();

    expect(
      await screen.findByText(
        "Another of your machines is called Studio Mac. Pick another name."
      )
    ).toBeTruthy();
  });

  test("shows the open set, its masthead and its saves once signed in", async () => {
    mockApp(signedIn());
    showPanel();

    expect(
      await screen.findByRole("heading", { name: "science123" })
    ).toBeTruthy();
    expect(
      screen.getByText("main \u00b7 2h 14m in this set since the last commit")
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "2 saves since \u2018added strings\u2019",
      })
    ).toBeTruthy();
  });

  test("offers to track the folder of an open set dit does not know", async () => {
    mockApp(signedIn({ adoptOffer: base.adoptOffer }));
    showPanel();

    expect(
      await screen.findByRole("heading", { name: "Track this project?" })
    ).toBeTruthy();
  });

  test("lists the repos when nothing is open", async () => {
    mockApp(signedIn({ open: null }));
    showPanel();

    expect(await screen.findByRole("heading", { name: "Repos" })).toBeTruthy();
    expect(screen.getByText("science Project")).toBeTruthy();
  });

  test("shows the notices the app holds without pulling the set masthead over them", async () => {
    mockApp(signedIn({ notices: ["The previous session may still be open."] }));
    showPanel();

    expect((await screen.findByRole("status")).textContent).toBe(
      "The previous session may still be open."
    );
    const masthead = screen.getByRole("region", { name: "The open set" });
    expect(masthead.className).not.toContain("-mt-4");

    await act(() => emit(STATE_EVENT, signedIn({ notices: [] })));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "The open set" }).className
      ).toContain("-mt-4")
    );
  });

  test("follows the app's pushes from one screen to the next", async () => {
    mockApp(signedIn({ open: null }));
    showPanel();
    await screen.findByRole("heading", { name: "Repos" });

    await act(() => emit(STATE_EVENT, signedIn()));
    expect(
      await screen.findByRole("heading", { name: "science123" })
    ).toBeTruthy();

    await act(() =>
      emit(
        STATE_EVENT,
        snapshotWith({
          auth: { state: "revoked", host: "https://h.example", pending: null },
        })
      )
    );
    expect(
      await screen.findByText(
        "Signed out of https://h.example. Sign in to keep pushing."
      )
    ).toBeTruthy();
  });

  describe("a restore link", () => {
    const pendingRestore = {
      commitId: 4412,
      message: "added strings",
      set: "science",
      branch: "restore-a1b2c3d",
      problem: null,
    };

    test("takes the panel from the open set when it arrives, and gives the set back once let go", async () => {
      mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await act(() =>
        emit(
          STATE_EVENT,
          signedIn({ pendingRestore, restore: { state: "idle" } })
        )
      );
      expect(
        await screen.findByRole("heading", {
          name: "Restore 'added strings' as a new branch",
        })
      ).toBeTruthy();

      await act(() => emit(STATE_EVENT, signedIn({ pendingRestore: null })));
      expect(
        await screen.findByRole("heading", { name: "science123" })
      ).toBeTruthy();
    });

    test("follows the restore from fetching to opened as the app reports it", async () => {
      mockApp(
        signedIn({ pendingRestore, restore: { state: "fetching", objects: 0 } })
      );
      showPanel();
      expect(await screen.findByText(/Fetching the commit/)).toBeTruthy();

      await act(() =>
        emit(
          STATE_EVENT,
          signedIn({
            pendingRestore,
            restore: { state: "writing", file: "science @restore-a1b2.als" },
          })
        )
      );
      expect(
        await screen.findByText("Writing science @restore-a1b2.als\u2026")
      ).toBeTruthy();

      await act(() =>
        emit(
          STATE_EVENT,
          signedIn({
            pendingRestore,
            restore: {
              state: "opened",
              file: "science @restore-a1b2.als",
              note: null,
            },
          })
        )
      );
      expect(await screen.findByText("Opened in Live")).toBeTruthy();
    });

    test("Esc is Cancel until a restore runs, then only hides the panel", async () => {
      const calls = mockApp(
        signedIn({ pendingRestore, restore: { state: "idle" } })
      );
      showPanel();
      await screen.findByRole("textbox", { name: "Branch name" });

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(argsOf(calls, "cancel_restore")).toHaveLength(1)
      );
      expect(argsOf(calls, "hide_panel")).toHaveLength(0);

      await act(() =>
        emit(
          STATE_EVENT,
          signedIn({
            pendingRestore,
            restore: { state: "writing", file: "science @restore-a1b2.als" },
          })
        )
      );
      await screen.findByText(/Writing science/);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(argsOf(calls, "hide_panel")).toHaveLength(1);
      expect(argsOf(calls, "cancel_restore")).toHaveLength(1);
    });
  });

  describe("the renders waiting", () => {
    test("show under the set's saves and not at all when none waits", async () => {
      mockApp(signedIn({ renders: [card()] }));
      showPanel();

      expect(
        await screen.findByRole("heading", { name: /New bounce/ })
      ).toBeTruthy();
      expect(
        screen.getByRole("option", { name: "science123 v4.wav" })
      ).toBeTruthy();

      await act(() => emit(STATE_EVENT, signedIn({ renders: [] })));
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: /New bounce/ })).toBeNull()
      );
    });

    test("stay reachable on the repo list when no set is open", async () => {
      mockApp(signedIn({ open: null, renders: [card()] }));
      showPanel();

      expect(
        await screen.findByRole("heading", { name: "Repos" })
      ).toBeTruthy();
      expect(
        screen.getByRole("option", { name: "science123 v4.wav" })
      ).toBeTruthy();
    });
  });

  describe("the menu", () => {
    test("opens Settings and the repo list, each with a way back", async () => {
      mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Settings");
      expect(
        await screen.findByRole("heading", { name: "Settings" })
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Repos");
      expect(
        await screen.findByRole("heading", { name: "Repos" })
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(
        await screen.findByRole("heading", { name: "science123" })
      ).toBeTruthy();
    });

    test("signs out and quits", async () => {
      const calls = mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Sign out");
      await waitFor(() => expect(argsOf(calls, "sign_out")).toHaveLength(1));

      await openMenuItem("Quit");
      await waitFor(() => expect(argsOf(calls, "quit")).toHaveLength(1));
    });

    test("surfaces why signing out failed", async () => {
      mockApp(signedIn(), (command) => {
        if (command === "sign_out") throw "Can't reach the Keychain.";
      });
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Sign out");

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Can't reach the Keychain."
      );
    });

    test("says on Quit that scheduled work stops with it", async () => {
      mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));

      const quit = await screen.findByRole("menuitem", { name: /^Quit/ });
      expect(quit.textContent).toContain("Scheduled work stops");
    });

    test("offers no update while there is none", async () => {
      mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));

      await screen.findByRole("menuitem", { name: /^Quit/ });
      expect(screen.queryByRole("menuitem", { name: /^Update/ })).toBeNull();
    });

    test("offers the update by its version and asks the app to take it", async () => {
      const calls = mockApp(
        signedIn({ update: { state: "available", version: "0.10.0" } })
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Update to 0.10.0");

      await waitFor(() =>
        expect(argsOf(calls, "install_update")).toHaveLength(1)
      );
    });

    test("offers the update to a signed-out app too", async () => {
      mockApp(
        snapshotWith({
          auth: { state: "signed-out", host: null, pending: null },
          update: { state: "available", version: "0.10.0" },
        })
      );
      showPanel();
      await screen.findByRole("button", { name: "Sign in" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));

      expect(
        await screen.findByRole("menuitem", { name: "Update to 0.10.0" })
      ).toBeTruthy();
    });

    test("says Updating… from the click, and the item cannot be chosen again", async () => {
      const calls = mockApp(
        signedIn({ update: { state: "installing", version: "0.10.0" } })
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      const updating = await screen.findByRole("menuitem", {
        name: "Updating…",
      });
      fireEvent.click(updating);

      expect(updating.getAttribute("aria-disabled")).toBe("true");
      expect(screen.queryByRole("menuitem", { name: /^Update to/ })).toBeNull();
      expect(argsOf(calls, "install_update")).toHaveLength(0);
    });

    test("keeps the offer after a failed update, with the line under it", async () => {
      mockApp(
        signedIn({
          update: {
            state: "failed",
            version: "0.10.0",
            message: "Couldn't update to 0.10.0. Try again later.",
          },
        })
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));

      const offer = await screen.findByRole("menuitem", {
        name: /^Update to 0.10.0/,
      });
      expect(offer.textContent).toContain(
        "Couldn't update to 0.10.0. Try again later."
      );
    });

    test("shows why the app would not take the update", async () => {
      mockApp(
        signedIn({ update: { state: "available", version: "0.10.0" } }),
        (command) => {
          if (command === "install_update") {
            throw "This build doesn't update itself.";
          }
          return undefined;
        }
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Update to 0.10.0");

      expect(
        await screen.findByText("This build doesn't update itself.")
      ).toBeTruthy();
    });

    test("Bring in projects… asks the app to open the backfill window, with nothing under it while there is no run", async () => {
      const calls = mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      const item = await screen.findByRole("menuitem", {
        name: /^Bring in projects…/,
      });
      expect(item.textContent).toBe("Bring in projects…");
      fireEvent.click(item);

      await waitFor(() =>
        expect(argsOf(calls, "open_backfill")).toHaveLength(1)
      );
    });

    test("Bring in projects… says Running or Paused under it while a run exists", async () => {
      mockApp(signedIn({ backfill: { state: "running" } }));
      showPanel();
      await screen.findByRole("heading", { name: "science123" });
      fireEvent.click(screen.getByRole("button", { name: "Menu" }));

      const item = await screen.findByRole("menuitem", {
        name: /^Bring in projects…/,
      });
      expect(item.textContent).toBe("Bring in projects…Running");

      await act(() =>
        emit(STATE_EVENT, signedIn({ backfill: { state: "paused" } }))
      );
      await waitFor(() =>
        expect(
          screen.getByRole("menuitem", { name: /^Bring in projects…/ })
            .textContent
        ).toBe("Bring in projects…Paused")
      );
    });

    test("Bring in projects… shows why the window would not open", async () => {
      mockApp(signedIn(), (command) => {
        if (command === "open_backfill") throw "The window can't open.";
      });
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Bring in projects");

      expect(await screen.findByText("The window can't open.")).toBeTruthy();
    });

    test("Track a folder… takes a folder from the picker to the app and shows the offer it makes", async () => {
      const calls = mockApp(signedIn(), (command) =>
        command === "plugin:dialog|open"
          ? "/Users/me/Music/other Project"
          : undefined
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Track a folder");

      await waitFor(() =>
        expect(argsOf(calls, "track_folder")).toEqual([
          { folder: "/Users/me/Music/other Project" },
        ])
      );
      await act(() =>
        emit(STATE_EVENT, signedIn({ adoptOffer: base.adoptOffer }))
      );
      expect(
        await screen.findByRole("heading", { name: "Track this project?" })
      ).toBeTruthy();
    });

    test("Track a folder… asks the app for nothing when the picker is cancelled", async () => {
      const calls = mockApp(signedIn(), (command) =>
        command === "plugin:dialog|open" ? null : undefined
      );
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Track a folder");

      await waitFor(() =>
        expect(
          calls.some((call) => call.command === "plugin:dialog|open")
        ).toBe(true)
      );
      expect(argsOf(calls, "track_folder")).toEqual([]);
    });

    test("Track a folder… shows why the app would not track the folder", async () => {
      mockApp(signedIn(), (command) => {
        if (command === "plugin:dialog|open") return "/Users/me/Music";
        if (command === "track_folder") throw "That folder has no sets.";
      });
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      await openMenuItem("Track a folder");

      expect((await screen.findByRole("alert")).textContent).toBe(
        "That folder has no sets."
      );
    });
  });

  describe("keys", () => {
    test("Esc hides the panel from its home screen", async () => {
      const calls = mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.keyDown(window, { key: "Escape" });

      expect(argsOf(calls, "hide_panel")).toHaveLength(1);
    });

    test("Esc hides the panel while signing in", async () => {
      const calls = mockApp(base);
      showPanel();
      await screen.findByText("WDJB-MJHT");

      fireEvent.keyDown(window, { key: "Escape" });

      expect(argsOf(calls, "hide_panel")).toHaveLength(1);
    });

    test("⌘, opens settings and Esc backs out of them without hiding the panel", async () => {
      const calls = mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });

      fireEvent.keyDown(window, { key: ",", metaKey: true });
      expect(
        await screen.findByRole("heading", { name: "Settings" })
      ).toBeTruthy();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(
        await screen.findByRole("heading", { name: "science123" })
      ).toBeTruthy();
      expect(argsOf(calls, "hide_panel")).toHaveLength(0);
    });

    test("Esc hides the panel from a repo list that is the home screen, and backs out of one navigated to first", async () => {
      const calls = mockApp(signedIn({ open: null }));
      showPanel();
      await screen.findByRole("heading", { name: "Repos" });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(argsOf(calls, "hide_panel")).toHaveLength(1);

      await openMenuItem("Repos");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(argsOf(calls, "hide_panel")).toHaveLength(1);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(argsOf(calls, "hide_panel")).toHaveLength(2);
    });

    test("⌘, does nothing before sign-in", async () => {
      mockApp(base);
      showPanel();
      await screen.findByText("WDJB-MJHT");

      fireEvent.keyDown(window, { key: ",", metaKey: true });

      expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    });

    test("Esc is left to a field that takes it: recording a shortcut is cancelled, not the panel", async () => {
      const calls = mockApp(signedIn());
      showPanel();
      await screen.findByRole("heading", { name: "science123" });
      fireEvent.keyDown(window, { key: ",", metaKey: true });
      fireEvent.click(
        await screen.findByRole("button", { name: /^Global shortcut:/ })
      );

      fireEvent.keyDown(
        screen.getByRole("button", {
          name: "Press the new keys for the global shortcut",
        }),
        { key: "Escape", code: "Escape" }
      );

      expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
      expect(argsOf(calls, "hide_panel")).toHaveLength(0);
    });
  });

  test("focuses the repo filter each time the panel is shown", async () => {
    mockApp(signedIn({ open: null }));
    showPanel();
    const filter = await screen.findByLabelText("Filter repos");

    await waitFor(async () => {
      await emit(TauriEvent.WINDOW_FOCUS);
      expect(document.activeElement).toBe(filter);
    });
  });
});
