import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { Settings as SettingsValues, Snapshot } from "../ipc";
import type { SettingsTab } from "../panel-actions";
import {
  argsOf,
  base,
  mockApp,
  renderScreen,
  signedIn,
  teardown,
} from "../test-support";
import { Settings } from "./settings";

afterEach(teardown);

function settingsOf(
  settings: Partial<SettingsValues> = {},
  rest: Partial<Snapshot> = {}
): Snapshot {
  return signedIn({ settings: { ...base.settings, ...settings }, ...rest });
}

function show(snapshot: Snapshot, initialTab: SettingsTab = "general"): void {
  renderScreen(<Settings snapshot={snapshot} initialTab={initialTab} />, "settings");
}

function sentSettings(calls: ReturnType<typeof mockApp>): unknown[] {
  return argsOf(calls, "set_setting");
}

describe("Settings", () => {
  test("switches between General, Bounces, and Live tabs", () => {
    mockApp(base);
    show(settingsOf());

    expect(screen.getByLabelText("Machine name")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Bounces" }));
    expect(screen.getByLabelText("Max upload size")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    expect(screen.getByText(/Live's dit script/)).toBeTruthy();
  });

  test("names the machine, instance, app version, and web devices link", async () => {
    const calls = mockApp(base);
    show(settingsOf());

    expect(
      (screen.getByLabelText("Machine name") as HTMLInputElement).value
    ).toBe("Studio Mac");
    expect(screen.getByText("https://projammr.example")).toBeTruthy();
    expect(screen.getByText("v1.0.0")).toBeTruthy();
    expect(screen.queryByLabelText("Instance")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Devices on web" }));
    await waitFor(() =>
      expect(argsOf(calls, "open_web")).toEqual([
        { path: "/settings/devices" },
      ])
    );
  });

  test("renames the machine when the field is left or Enter is pressed, shows Saved, and ignores unchanged or empty names", async () => {
    const calls = mockApp(base);
    show(settingsOf());
    const field = screen.getByLabelText("Machine name");

    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "Studio Mac" } });
    fireEvent.blur(field);
    expect(sentSettings(calls)).toEqual([]);

    fireEvent.change(field, { target: { value: "Laptop" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(sentSettings(calls)).toEqual([
        { key: "machineName", value: "Laptop" },
      ])
    );
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  test("turns start at login off and on", async () => {
    const calls = mockApp(base);
    show(settingsOf({ autostart: true }));
    const toggle = screen.getByRole("switch", { name: "Start at login" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(sentSettings(calls)).toEqual([{ key: "autostart", value: false }])
    );
  });

  test("shows why the app refused a change, and leaves the control as the app says it is", async () => {
    mockApp(base, (command) => {
      if (command === "set_setting")
        throw "Start at login is not set from here yet.";
    });
    show(settingsOf({ autostart: true }));

    fireEvent.click(screen.getByRole("switch", { name: "Start at login" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Start at login is not set from here yet."
    );
    expect(
      screen
        .getByRole("switch", { name: "Start at login" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  describe("the global shortcut", () => {
    const record = (): HTMLElement => {
      fireEvent.click(
        screen.getByRole("button", { name: /^Global shortcut:/ })
      );
      return screen.getByRole("button", {
        name: "Press the new keys for the global shortcut",
      });
    };

    test("is recorded by pressing it, as an accelerator", async () => {
      const calls = mockApp(base);
      show(settingsOf({ shortcut: null }));

      fireEvent.keyDown(record(), {
        key: "∂",
        code: "KeyD",
        altKey: true,
        shiftKey: true,
      });

      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([
          { key: "shortcut", value: "Alt+Shift+D" },
        ])
      );
    });

    test("refuses a bare letter with a message and goes on recording", async () => {
      const calls = mockApp(base);
      show(settingsOf({ shortcut: null }));
      const recorder = record();

      fireEvent.keyDown(recorder, { key: "d", code: "KeyD" });

      expect((await screen.findByRole("alert")).textContent).toContain(
        "needs ⌃, ⌥ or ⌘ held with the key"
      );
      expect(sentSettings(calls)).toEqual([]);

      fireEvent.keyDown(recorder, { key: "d", code: "KeyD", ctrlKey: true });
      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([
          { key: "shortcut", value: "Ctrl+D" },
        ])
      );
    });

    test("is cancelled by a bare Escape, which the panel's own Esc never sees", () => {
      const calls = mockApp(base);
      show(settingsOf());
      let reached = false;
      window.addEventListener("keydown", () => (reached = true), {
        once: true,
      });

      fireEvent.keyDown(record(), { key: "Escape", code: "Escape" });

      expect(reached).toBe(false);
      expect(
        screen.getByRole("button", { name: /^Global shortcut:/ })
      ).toBeTruthy();
      expect(sentSettings(calls)).toEqual([]);
    });

    test("is cleared", async () => {
      const calls = mockApp(base);
      show(settingsOf({ shortcut: "Alt+Shift+D" }));

      fireEvent.click(
        screen.getByRole("button", { name: "Clear the global shortcut" })
      );

      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([{ key: "shortcut", value: null }])
      );
    });

    test("says why the app could not register it", () => {
      mockApp(base);
      show(
        settingsOf({ shortcutError: "Alt+Shift+D is taken by another app." })
      );

      expect(screen.getByRole("alert").textContent).toBe(
        "Alt+Shift+D is taken by another app."
      );
    });
  });

  describe("max upload size", () => {
    const field = (): HTMLElement => screen.getByLabelText("Max upload size");

    test("sets a whole number of megabytes and shows an inline MB suffix", async () => {
      const calls = mockApp(base);
      show(settingsOf({ maxUploadMb: 12 }), "bounces");
      expect((field() as HTMLInputElement).value).toBe("12");
      expect(screen.getByText("MB")).toBeTruthy();

      fireEvent.change(field(), { target: { value: "25" } });
      fireEvent.keyDown(field(), { key: "Enter" });

      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([{ key: "maxUploadMb", value: 25 }])
      );
    });

    test("refuses anything else without asking the app", () => {
      const calls = mockApp(base);
      show(settingsOf(), "bounces");

      fireEvent.change(field(), { target: { value: "12 MB" } });
      fireEvent.blur(field());

      expect(screen.getByRole("alert").textContent).toBe(
        "Enter a whole number of megabytes, or 0 for no limit."
      );
      expect(sentSettings(calls)).toEqual([]);
    });
  });

  describe("folders", () => {
    test("adds the folders the picker returns, shortens home paths with ~/, and shows default home notice when empty", async () => {
      const calls = mockApp(base, (command) =>
        command === "plugin:dialog|open"
          ? ["/Users/me", "/Users/me/Music"]
          : undefined
      );
      show(settingsOf({ watchRoots: ["/Users/me"] }), "bounces");
      expect(screen.getByText("~/")).toBeTruthy();
      const [add] = screen.getAllByRole("button", { name: "Add folder…" });

      fireEvent.click(add!);

      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([
          { key: "watchRoots", value: ["/Users/me", "/Users/me/Music"] },
        ])
      );

      teardown();
      mockApp(base);
      show(settingsOf({ watchRoots: [] }), "bounces");
      expect(
        screen.getByText(
          "Watching entire home folder (~/). Add folders to narrow where dit looks."
        )
      ).toBeTruthy();
    });

    test("adds nothing when the picker is cancelled", async () => {
      const calls = mockApp(base, (command) =>
        command === "plugin:dialog|open" ? null : undefined
      );
      show(settingsOf(), "bounces");
      const [add] = screen.getAllByRole("button", { name: "Add folder…" });

      fireEvent.click(add!);

      await waitFor(() =>
        expect(argsOf(calls, "plugin:dialog|open")).toHaveLength(1)
      );
      expect(sentSettings(calls)).toEqual([]);
    });

    test("removes a folder from the list it is in", async () => {
      const calls = mockApp(base);
      show(
        settingsOf({ excluded: ["/Users/me/Library", "/Users/me/Trash"] }),
        "bounces"
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Remove ~/Library" })
      );

      await waitFor(() =>
        expect(sentSettings(calls)).toEqual([
          { key: "excluded", value: ["/Users/me/Trash"] },
        ])
      );
    });

    test("surfaces why the folder picker failed", async () => {
      mockApp(base, (command) => {
        if (command === "plugin:dialog|open") {
          throw "The folder picker couldn't open.";
        }
      });
      show(settingsOf(), "bounces");
      const [add] = screen.getAllByRole("button", { name: "Add folder…" });

      fireEvent.click(add!);

      expect((await screen.findByRole("alert")).textContent).toBe(
        "The folder picker couldn't open."
      );
    });
  });

  describe("what the render watcher skips and remembers", () => {
    test("collapses built-in exclusions behind a disclosure beside the person's own", () => {
      mockApp(base);
      show(
        settingsOf({
          builtInExcluded: ["Library", "node_modules", "Trash"],
          excluded: ["/Users/me/Backups"],
        }),
        "bounces"
      );

      expect(
        screen.queryByText("Always skipped: Library, node_modules, Trash.")
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "3 built-in exclusions" })
      );
      expect(
        screen.getByText("Always skipped: Library, node_modules, Trash.")
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Remove Library" })
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Remove ~/Backups" })
      ).toBeTruthy();
    });

    test("collapses ignored bounces & folders, humanizes fingerprints, and forgets by fingerprint", async () => {
      const calls = mockApp(base);
      show(
        settingsOf({
          neverHereFolders: [],
          rejectedFiles: [
            {
              fingerprint: "dit:100:abc",
              name: "demo take 3.wav",
              folder: "/Users/me/Music/Exports",
            },
            { fingerprint: "dit:200:def", name: null, folder: null },
          ],
        }),
        "bounces"
      );

      expect(screen.queryByText("Files marked Not a bounce")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: /Ignored bounces & folders \(2\)/ })
      );

      expect(screen.getByText("Files marked Not a bounce")).toBeTruthy();
      expect(screen.getByText("~/Music/Exports")).toBeTruthy();
      expect(
        screen.getByText("Not-a-bounce choices sync across devices.")
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Forget demo take 3.wav" })
      );

      await waitFor(() =>
        expect(argsOf(calls, "forget_rejection")).toEqual([
          { fingerprint: "dit:100:abc" },
        ])
      );
      expect(
        screen.getByRole("button", {
          name: "Forget Unnamed file (200 Bytes · def)",
        })
      ).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Manage on web" })
      );
      await waitFor(() =>
        expect(argsOf(calls, "open_web")).toEqual([
          { path: "/settings/devices" },
        ])
      );
    });

    test("lists the folders marked Never here and takes one back", async () => {
      const calls = mockApp(base);
      show(
        settingsOf({
          rejectedFiles: [],
          neverHereFolders: ["/Users/me/Bounces/old"],
        }),
        "bounces"
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Ignored bounces & folders \(1\)/ })
      );
      expect(screen.getByText("Folders marked Never here")).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Forget ~/Bounces/old" })
      );

      await waitFor(() =>
        expect(argsOf(calls, "forget_never_here")).toEqual([
          { folder: "/Users/me/Bounces/old" },
        ])
      );
    });

    test("says so when nothing is marked, and shows the app's refusal to forget", async () => {
      mockApp(base, (command) => {
        if (command === "forget_never_here") throw "That folder isn't marked.";
      });
      show(
        settingsOf({ rejectedFiles: [], neverHereFolders: ["/x"] }),
        "bounces"
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Ignored bounces & folders \(1\)/ })
      );
      expect(screen.getByText("No file is marked.")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Forget /x" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "That folder isn't marked."
      );
    });
  });

  describe("Live's script", () => {
    test("reinstalls while connected, says which Live said hello and shortens the script path", async () => {
      const calls = mockApp(base);
      const path = "/Users/me/Music/Ableton/User Library/Remote Scripts/dit";
      show(
        settingsOf({}, { script: { state: "connected", live: "12.4.6", path } }),
        "live"
      );
      expect(screen.getByText("Connected · Live 12.4.6")).toBeTruthy();
      expect(
        screen.getByText(
          "Installed at ~/Music/Ableton/User Library/Remote Scripts/dit"
        )
      ).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Reinstall Live's dit script" })
      );

      await waitFor(() =>
        expect(argsOf(calls, "install_script")).toHaveLength(1)
      );
    });

    test("tells how to enable it once installed, and offers Install with accurate not-installed copy", () => {
      mockApp(base);
      const { unmount } = renderScreen(
        <Settings
          initialTab="live"
          snapshot={settingsOf(
            {},
            {
              script: {
                state: "installed",
                live: null,
                path: "/Library/Remote Scripts/dit",
              },
            }
          )}
        />
      );
      expect(screen.getByText("Installed · Not connected")).toBeTruthy();
      expect(
        screen.getByText(
          "Live's dit script isn't enabled. Enable it in Live › Settings › Link, Tempo & MIDI for live changes."
        )
      ).toBeTruthy();
      unmount();

      show(
        settingsOf(
          { cliInstalled: null },
          { script: { state: "not-installed", live: null, path: null } }
        ),
        "live"
      );
      expect(screen.getByText("Not installed")).toBeTruthy();
      expect(
        screen.getByText(
          "Install dit's script into Live's User Library, then enable it in Live › Settings › Link, Tempo & MIDI."
        )
      ).toBeTruthy();
      expect(screen.queryByText(/^Installed at/)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Install Live's dit script" })
      ).toBeTruthy();
    });

    test("says Live wasn't found when there is no script kit to install into", () => {
      mockApp(base);
      show(
        settingsOf(
          {},
          { script: { state: "live-not-found", live: null, path: null } }
        ),
        "live"
      );

      expect(screen.getByText("Live wasn't found.")).toBeTruthy();
      expect(screen.queryByText("Not installed")).toBeNull();
    });
  });

  describe("the dit command", () => {
    test("says where it is installed on one line and has no button to install it again", () => {
      mockApp(base);
      show(settingsOf({ cliInstalled: "/usr/local/bin/dit" }));

      expect(screen.getByText("Installed at /usr/local/bin/dit")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Install the dit command" })
      ).toBeNull();
    });

    test("installs it, and shows the app's refusal", async () => {
      const calls = mockApp(base, (command) => {
        if (command === "install_cli")
          throw "dit can't link the command under the dev identifier.";
      });
      show(
        settingsOf(
          { cliInstalled: null },
          { script: { state: "connected", live: "12", path: null } }
        )
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Install the dit command" })
      );

      expect((await screen.findByRole("alert")).textContent).toBe(
        "dit can't link the command under the dev identifier."
      );
      expect(argsOf(calls, "install_cli")).toHaveLength(1);
    });
  });

  describe("permissions", () => {
    test("explains Screen Recording and asks for it", async () => {
      const calls = mockApp(base);
      show(settingsOf({}, { permissions: { screenRecording: false } }), "live");
      expect(screen.getByText("Screen Recording: Not allowed")).toBeTruthy();
      expect(screen.getByText(/dit reads Live's window title/)).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Open System Settings" })
      );

      await waitFor(() =>
        expect(argsOf(calls, "request_screen_recording")).toHaveLength(1)
      );
    });

    test("has nothing to ask once it is allowed, and still explains the folder prompts", () => {
      mockApp(base);
      show(settingsOf({}, { permissions: { screenRecording: true } }), "live");

      expect(screen.getByText("Screen Recording: Allowed")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Open System Settings" })
      ).toBeNull();
      expect(
        screen.getByText(/macOS asks before dit reads a file in Desktop/)
      ).toBeTruthy();
    });
  });
});
