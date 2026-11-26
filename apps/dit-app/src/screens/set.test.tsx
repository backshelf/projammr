import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  type RenderResult,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { emit, TauriEvent } from "@tauri-apps/api/event";

import type { OpenSet, Snapshot } from "../ipc";
import { DRAFTS_KEY } from "../set/draft";
import {
  argsOf,
  base,
  mockApp,
  renderScreen,
  signedIn,
  teardown,
} from "../test-support";
import { Chrome } from "../test-chrome";
import { SetScreen } from "./set";

beforeEach(() => localStorage.clear());
afterEach(async () => {
  await teardown();
  localStorage.clear();
});

/** The fixture's set with its quiet defaults: no draft kept in the app, no live tracks, no proposal. */
function quiet(changes: Partial<Snapshot> = {}): Snapshot {
  return signedIn({
    draft: "",
    liveTracks: null,
    trackProposal: null,
    ...changes,
  });
}

function showSet(snapshot: Snapshot): RenderResult {
  return renderScreen(
    <SetScreen snapshot={snapshot} open={snapshot.open as OpenSet} />
  );
}

const message = (): HTMLTextAreaElement =>
  screen.getByRole("textbox", { name: "Commit message" });
const chip = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("the masthead", () => {
  test("names the set, its branch and the time in it since the last commit", () => {
    mockApp(quiet());
    showSet(quiet());

    expect(screen.getByRole("heading", { name: "science123" })).toBeTruthy();
    expect(
      screen.getByText("main \u00b7 2h 14m in this set since the last commit")
    ).toBeTruthy();
  });

  test("says nothing of time when none is counted", () => {
    const snapshot = quiet({ timeSinceCommit: null });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("main")).toBeTruthy();
  });

  test("opens the set's page on the web", async () => {
    const snapshot = quiet();
    const calls = mockApp(snapshot);
    showSet(snapshot);

    fireEvent.click(screen.getByRole("button", { name: /Open on the web/ }));

    await waitFor(() =>
      expect(argsOf(calls, "open_web")).toEqual([
        { path: "/project/4/session/812" },
      ])
    );
  });

  test("offers no link to a set no push has made a session", () => {
    const snapshot = quiet();
    const open = { ...(snapshot.open as OpenSet), webPath: null };
    mockApp(snapshot);
    showSet({ ...snapshot, open });

    expect(screen.queryByText(/Open on the web/)).toBeNull();
  });

  test("is lit by the track's artwork through the app's scheme and takes its accent", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    const { container } = showSet(snapshot);

    const style = container.querySelector("[style]")?.getAttribute("style");
    expect(style).toContain(
      'url("dit-art://localhost/static/images/9f2c.webp?w=800")'
    );
    expect(style).toContain("--art-light: oklch(0.55 0.182 262.5)");
    expect(container.querySelector(".masthead__field")).not.toBeNull();
  });

  test("draws no band and keeps the grayscale accent with no artwork", () => {
    const snapshot = quiet({ artwork: null });
    mockApp(snapshot);
    const { container } = showSet(snapshot);

    expect(container.querySelector(".masthead__art")).toBeNull();
    expect(container.querySelector("[style]")?.getAttribute("style")).toContain(
      "--art-image: none"
    );
  });
});

describe("the commit box", () => {
  test("holds the suggestion, with a chip for each clause and the helper line", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    expect(message().value).toBe(
      "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124"
    );
    for (const name of [
      "+1 track",
      "+EQ Eight on Bass",
      "tempo 120 \u2192 124",
    ]) {
      expect(chip(name).getAttribute("aria-pressed")).toBe("true");
    }
    expect(
      screen.getByText(
        "A commit names the set as it is now, so you can find it later."
      )
    ).toBeTruthy();
  });

  test("a clause toggled off drops from the message, and comes back when toggled on", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    fireEvent.click(chip("+EQ Eight on Bass"));
    expect(message().value).toBe("+1 track, tempo 120 \u2192 124");
    expect(chip("+EQ Eight on Bass").getAttribute("aria-pressed")).toBe(
      "false"
    );

    fireEvent.click(chip("+EQ Eight on Bass"));
    expect(message().value).toBe(
      "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124"
    );
  });

  test("typed text wins: a dropped clause re-adds after an edit, at the end of what was written", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    fireEvent.click(chip("+EQ Eight on Bass"));
    fireEvent.change(message(), { target: { value: "kick tightened" } });
    expect(chip("+1 track").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip("+EQ Eight on Bass"));
    expect(message().value).toBe("kick tightened, +EQ Eight on Bass");
  });

  test("typed text is kept when a new save changes the suggestion; untouched text follows it", () => {
    const first = quiet();
    mockApp(first);
    const { rerender } = showSet(first);
    const showNext = (snapshot: Snapshot): void =>
      rerender(
        <Chrome nav="home">
          <SetScreen snapshot={snapshot} open={snapshot.open as OpenSet} />
        </Chrome>
      );
    const scenes = quiet({ clauses: [{ kind: "scenes", text: "+2 scenes" }] });

    showNext(scenes);
    expect(message().value).toBe("+2 scenes");

    fireEvent.change(message(), { target: { value: "mine" } });
    showNext(first);
    expect(message().value).toBe("mine");
  });

  test("the draft survives a remount, the chips as the person left them", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    const { unmount } = showSet(snapshot);
    fireEvent.click(chip("tempo 120 \u2192 124"));
    unmount();

    showSet(snapshot);
    expect(message().value).toBe("+1 track, +EQ Eight on Bass");
    expect(chip("tempo 120 \u2192 124").getAttribute("aria-pressed")).toBe(
      "false"
    );

    fireEvent.change(message(), { target: { value: "half a thought" } });
    cleanup();
    showSet(snapshot);
    expect(message().value).toBe("half a thought");
  });

  test("the draft is kept per set", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    const { unmount } = showSet(snapshot);
    fireEvent.change(message(), { target: { value: "for science123" } });
    unmount();

    const other = {
      ...snapshot,
      open: {
        ...(snapshot.open as OpenSet),
        path: "/Users/me/Music/science Project/other.als",
        name: "other",
      },
    };
    showSet(other);
    expect(message().value).toBe(
      "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124"
    );
  });

  test("opens on the text the app kept when the panel kept none", () => {
    const snapshot = quiet({ draft: "+EQ Eight on Bass, kick tightened" });
    mockApp(snapshot);
    showSet(snapshot);

    expect(message().value).toBe("+EQ Eight on Bass, kick tightened");
    expect(chip("+EQ Eight on Bass").getAttribute("aria-pressed")).toBe("true");
    expect(chip("+1 track").getAttribute("aria-pressed")).toBe("false");
  });

  test("tells the app the text as it is typed", async () => {
    const snapshot = quiet();
    const calls = mockApp(snapshot);
    showSet(snapshot);

    fireEvent.change(message(), { target: { value: "tightened" } });

    await waitFor(() =>
      expect(argsOf(calls, "set_draft")).toEqual([
        { set: snapshot.open?.path, message: "tightened" },
      ])
    );
  });

  test("Commit sends the message, and the draft is let go", async () => {
    const snapshot = quiet();
    const calls = mockApp(snapshot);
    showSet(snapshot);
    fireEvent.change(message(), { target: { value: "added strings" } });

    fireEvent.click(screen.getByRole("button", { name: /^Commit/ }));

    await waitFor(() =>
      expect(argsOf(calls, "commit")).toEqual([
        { set: snapshot.open?.path, message: "added strings" },
      ])
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")).toEqual({})
    );
  });

  test("\u2318\u21a9 commits from inside the box", async () => {
    const snapshot = quiet();
    const calls = mockApp(snapshot);
    showSet(snapshot);

    fireEvent.keyDown(message(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(argsOf(calls, "commit")).toEqual([
        {
          set: snapshot.open?.path,
          message: "+1 track, +EQ Eight on Bass, tempo 120 \u2192 124",
        },
      ])
    );
  });

  test("a bare Enter is a new line, not a commit", () => {
    const snapshot = quiet();
    const calls = mockApp(snapshot);
    showSet(snapshot);

    fireEvent.keyDown(message(), { key: "Enter" });

    expect(argsOf(calls, "commit")).toEqual([]);
  });

  test("shows why a commit was refused, in the danger ink, and keeps the draft", async () => {
    const snapshot = quiet();
    mockApp(snapshot, (command) => {
      if (command === "commit") throw "Nothing to commit since added strings.";
    });
    showSet(snapshot);
    fireEvent.change(message(), { target: { value: "again" } });

    fireEvent.click(screen.getByRole("button", { name: /^Commit/ }));

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toBe("Nothing to commit since added strings.");
    expect(refusal.className).toContain("text-danger");
    expect(message().getAttribute("aria-invalid")).toBe("true");
    expect(localStorage.getItem(DRAFTS_KEY)).toContain("again");
  });

  test("takes focus when the panel is shown", async () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    await act(() => emit(TauriEvent.WINDOW_FOCUS));

    await waitFor(() => expect(document.activeElement).toBe(message()));
  });

  test("asks for no message on the first commit, which the app names", () => {
    const snapshot = quiet({
      firstCommit: true,
      clauses: [],
      lastCommit: null,
      headMeta: null,
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(message().value).toBe("");
    expect(message().getAttribute("placeholder")).toBe("Initial commit");
    expect(
      screen.queryByRole("list", { name: "Suggested message" })
    ).toBeNull();
  });
});

describe("the saves", () => {
  test("lists each save with what it changed, read against the one before and the commit", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.getByRole("heading", {
        name: "2 saves since \u2018added strings\u2019",
      })
    ).toBeTruthy();
    const region = screen.getByRole("region", { name: /saves since/ });
    const list = within(region);
    // The newest save is read against the commit, since the save between could not be read.
    expect(region.textContent).toContain("tempo 120 \u2192 124");
    expect(list.getByText("+EQ Eight on Bass")).toBeTruthy();
    expect(list.getByText("Couldn\u2019t read this save")).toBeTruthy();
  });

  test("marks each save with whether the hub has it", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByRole("img", { name: "Pushing" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Waiting to push" })).toBeTruthy();
    expect(screen.getByText("pushing")).toBeTruthy();
    expect(screen.getByText("pending")).toBeTruthy();
  });

  test("a pushed save has the ink dot and no word beside it", () => {
    const snapshot = quiet({
      saves: quiet().saves.map((save) => ({
        ...save,
        push: "pushed" as const,
      })),
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getAllByRole("img", { name: "Pushed" })).toHaveLength(2);
    expect(screen.queryByText("pending")).toBeNull();
  });

  test("counts one save in the singular, and a set with no commit by the count alone", () => {
    const snapshot = quiet({
      saves: quiet().saves.slice(0, 1),
      lastCommit: null,
      headMeta: null,
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByRole("heading", { name: "1 save" })).toBeTruthy();
    expect(screen.getByText("First save seen")).toBeTruthy();
  });
});

describe("nothing to commit", () => {
  test("says so, with the last commit where the saves would be", () => {
    const snapshot = quiet({ saves: [] });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Nothing to commit")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Last commit" })).toBeTruthy();
    expect(screen.getByText("added strings")).toBeTruthy();
    expect(screen.getByText(/pushed/)).toBeTruthy();
  });

  test("says a last commit is waiting to push", () => {
    const snapshot = quiet({
      saves: [],
      lastCommit: {
        message: "added strings",
        at: 1759990000000,
        push: "pending",
      },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText(/waiting to push/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Waiting to push" })).toBeTruthy();
  });

  test("has no last commit to show for a set that has none", () => {
    const snapshot = quiet({ saves: [], lastCommit: null });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Nothing to commit")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Last commit" })).toBeNull();
  });

  test("leaves the skyline unlit", () => {
    const snapshot = quiet({
      saves: [],
      tracksChanged: [],
      latestMeta: quiet().headMeta,
    });
    mockApp(snapshot);
    const { container } = showSet(snapshot);

    expect(container.querySelectorAll("[data-diff-bar]").length).toBe(3);
    expect(container.querySelectorAll("[data-mark]").length).toBe(0);
  });
});

describe("the track proposal", () => {
  test("asks which track the set is, with a new track last", () => {
    const snapshot = quiet({
      firstCommit: true,
      trackProposal: {
        choices: [
          { label: "Canopy", track: "12" },
          { label: "Canopy (demo)", track: "31" },
        ],
        newTrack: "science",
      },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.getByRole("heading", { name: "Which track is this?" })
    ).toBeTruthy();
    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => /Canopy|New track/.test(text ?? ""));
    expect(names).toEqual(["Canopy", "Canopy (demo)", "New track: science"]);
  });

  test("picking a track names it to the app", async () => {
    const snapshot = quiet({
      trackProposal: {
        choices: [{ label: "Canopy", track: "12" }],
        newTrack: "science",
      },
    });
    const calls = mockApp(snapshot);
    showSet(snapshot);

    fireEvent.click(screen.getByRole("button", { name: "Canopy" }));
    await waitFor(() =>
      expect(argsOf(calls, "propose_track")).toEqual([
        { set: snapshot.open?.path, track: "12" },
      ])
    );

    fireEvent.click(screen.getByRole("button", { name: "New track: science" }));
    await waitFor(() =>
      expect(argsOf(calls, "propose_track")).toEqual([
        { set: snapshot.open?.path, track: "12" },
        { set: snapshot.open?.path, track: "new" },
      ])
    );
  });

  test("shows why the app refused the pick", async () => {
    const snapshot = quiet({
      trackProposal: { choices: [], newTrack: "science" },
    });
    mockApp(snapshot, (command) => {
      if (command === "propose_track") throw "That set isn't open any more.";
    });
    showSet(snapshot);

    fireEvent.click(screen.getByRole("button", { name: "New track: science" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That set isn't open any more."
    );
  });

  test("is not there once the app has none to offer", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.queryByText("Which track is this?")).toBeNull();
  });
});

describe("the skyline", () => {
  test("is lit from the commit's metas and names the lit track", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    const { container } = showSet(snapshot);

    const marks = [...container.querySelectorAll("[data-diff-bar]")].map(
      (bar) => bar.getAttribute("data-mark")
    );
    expect(marks).toEqual([null, "changed", "added", null]);

    const group = screen.getByRole("group", { name: "The set's tracks" });
    act(() => group.focus());
    expect(container.querySelector("[aria-live]")?.textContent).toBe(
      "Bass \u00b7 +EQ Eight"
    );
  });

  test("shows the script's live tracks before a save", () => {
    const snapshot = quiet({
      tracksChanged: [],
      liveTracks: [
        { kind: "audio", name: "Drums", devices: ["Drum Rack"], id: 1 },
        { kind: "midi", name: "Bass", devices: ["Operator"], id: 2 },
        { kind: "master", name: "Master", devices: [] },
        { kind: "audio", name: "Vox", devices: ["Reverb"], id: 9 },
      ],
    });
    mockApp(snapshot);
    const { container } = showSet(snapshot);

    const titles = [...container.querySelectorAll("[data-diff-bar]")].map(
      (bar) => bar.getAttribute("title")
    );
    expect(titles).toEqual(["Drums", "Bass", "Master", "Vox \u00b7 added"]);
  });

  test("is not drawn while the set has no tracks to draw", () => {
    const snapshot = quiet({ latestMeta: null, liveTracks: null });
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.queryByRole("group", { name: "The set's tracks" })
    ).toBeNull();
  });
});

describe("the renders", () => {
  test("stand under the saves with the label-shape heading, and are absent with none waiting", () => {
    const snapshot = quiet({ renders: base.renders });
    mockApp(snapshot);
    const { rerender } = showSet(snapshot);

    const saves = screen.getByRole("heading", { name: /saves since/ });
    const band = screen.getByRole("heading", { name: /New bounce/ });
    expect(
      saves.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const none = quiet({ renders: [] });
    rerender(
      <Chrome nav="home">
        <SetScreen snapshot={none} open={none.open as OpenSet} />
      </Chrome>
    );
    expect(screen.queryByRole("heading", { name: /New bounce/ })).toBeNull();
  });

  test("show with nothing to commit as well, under the last commit", () => {
    const snapshot = quiet({ saves: [], renders: base.renders });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Nothing to commit")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /New bounce/ })).toBeTruthy();
  });
});

describe("the lines under the set", () => {
  test("say Live is not running, and not that its script is off", () => {
    const snapshot = quiet({
      live: false,
      script: { state: "not-installed", live: null, path: null },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Live isn't running.")).toBeTruthy();
    expect(screen.queryByText(/dit script/)).toBeNull();
  });

  test("say the script is not enabled while Live runs without it", () => {
    const snapshot = quiet({
      script: { state: "installed", live: null, path: "/Library/dit" },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.getByText(
        "Live\u2019s dit script isn\u2019t enabled. Enable it in Live \u203a Settings \u203a Link, Tempo & MIDI for live changes."
      )
    ).toBeTruthy();
  });

  test("say nothing while Live and its script are well", () => {
    const snapshot = quiet();
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.queryByRole("status")).toBeNull();
  });

  test("say the hub cannot be reached and what is kept meanwhile", () => {
    const snapshot = quiet({
      connection: "offline",
      push: {
        state: "waiting",
        pending: 1,
        message: "The hub is unreachable.",
        progress: null,
      },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.getByText(
        "Can\u2019t reach projammr.example. Saves and commits are kept here and will push when it\u2019s back."
      )
    ).toBeTruthy();
  });

  test("say the hub refused the push, in the hub's words", () => {
    const snapshot = quiet({
      connection: "refused",
      push: {
        state: "failed",
        pending: 1,
        message: "Over the storage limit",
        progress: null,
      },
    });
    mockApp(snapshot);
    showSet(snapshot);

    const line = screen.getByText(
      "projammr.example refused the push: Over the storage limit."
    );
    expect(line.getAttribute("role")).toBe("alert");
    expect(line.className).toContain("text-danger");
  });

  test("say what is going up while a push runs", () => {
    const snapshot = quiet({
      push: { state: "pushing", pending: 1, message: null, progress: null },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Pushing to projammr.example\u2026")).toBeTruthy();
  });

  test("count the repos of a push burst when it has more than one", () => {
    const snapshot = quiet({
      push: {
        state: "pushing",
        pending: 3,
        message: null,
        progress: { done: 1, total: 3 },
      },
    });
    mockApp(snapshot);
    showSet(snapshot);

    expect(
      screen.getByText("Pushing to projammr.example\u2026 1 of 3 repos")
    ).toBeTruthy();
  });

  test("say the app is not signed in when no hub is", () => {
    const snapshot = quiet({ connection: "no-hub" });
    mockApp(snapshot);
    showSet(snapshot);

    expect(screen.getByText("Not signed in.")).toBeTruthy();
    expect(screen.queryByText(/nothing is pushed/)).toBeNull();
  });
});
