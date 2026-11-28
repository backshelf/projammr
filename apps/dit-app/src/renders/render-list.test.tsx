import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  fireEvent,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";

import type { RenderCard } from "../ipc";
import {
  argsOf,
  mockApp,
  base,
  renderScreen,
  signedIn,
  teardown,
  type Call,
} from "../test-support";
import { previewPlayer } from "./preview";
import { RenderBand } from "./render-list";
import { Chrome } from "../test-chrome";
import { card, MB, pair } from "./test-cards";
import { PanelActionsProvider, type PanelActions } from "../panel-actions";

let calls: Call[] = [];
beforeEach(() => {
  calls = mockApp(signedIn());
});
afterEach(async () => {
  previewPlayer.release();
  await teardown();
});

function show(cards: RenderCard[]): RenderResult {
  return renderScreen(<RenderBand cards={cards} />);
}

const focused = (): string | null =>
  document.activeElement?.getAttribute("data-render") ?? null;
const items = (): HTMLElement[] => screen.getAllByRole("listitem");
const selected = (): string | null =>
  items().find((item) => item.getAttribute("data-cursor") === "true")?.dataset
    .render ?? null;

describe("the band", () => {
  test("is nothing at all with no card, and nothing for a render still held back", () => {
    const { container, rerender } = show([]);
    expect(container.querySelector("[role=list]")).toBeNull();
    expect(screen.queryByText("New bounce")).toBeNull();

    rerender(<RenderBand cards={[card({ state: "waiting" })]} />);
    expect(container.querySelector("[role=list]")).toBeNull();
  });

  test("heads the cards with the label-shape heading and counts more than one", () => {
    show([card({ id: 1 }), card({ id: 2 })]);

    const heading = screen.getByRole("heading", { name: /New bounce/ });
    expect(heading.textContent).toContain("New bounce");
    expect(heading.textContent).toContain("2");
    expect(screen.getByRole("list", { name: /New bounce/ })).toBeTruthy();
  });
});

describe("a proposed card", () => {
  test("names the file whole, its folder, its facts and its reasons without duplicating timing", () => {
    show([card()]);

    const item = screen.getByRole("listitem", { name: "science123 v4.wav" });
    expect(within(item).getByText("science123 v4.wav")).toBeTruthy();
    expect(
      within(item).getByText("/Users/producer/Music/Exports")
    ).toBeTruthy();
    expect(within(item).getByText("3:42")).toBeTruthy();
    expect(within(item).getByText("48 MB")).toBeTruthy();
    expect(
      within(item).getByText("bounced 4 min after your last save")
    ).toBeTruthy();
    expect(
      within(item).getByText("named like the set \u00b7 in its folder")
    ).toBeTruthy();
  });

  test("wraps a long name rather than cutting it", () => {
    const long =
      "a very long bounce name that goes on and on v4 final final.wav";
    show([card({ files: [{ path: `/x/${long}`, size: 10 }] })]);

    const name = screen.getByText(long);
    expect(name.className).toContain("[overflow-wrap:anywhere]");
    expect(name.className).not.toContain("truncate");
  });

  test("offers the streamlined decisions and the play control", () => {
    show([card()]);

    for (const name of [
      "Add as version",
      "Not a bounce",
      "Other",
      "Play science123 v4.wav",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  test("adds as a version with the card's id", async () => {
    show([card({ id: 41 })]);

    fireEvent.click(screen.getByRole("button", { name: "Add as version" }));

    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 41 }])
    );
  });

  test("turns it down as not a bounce, or never watch after confirmation", async () => {
    show([card({ id: 41 })]);

    fireEvent.click(screen.getByRole("button", { name: "Not a bounce" }));
    await waitFor(() =>
      expect(argsOf(calls, "reject_render")).toEqual([
        { id: 41, mode: "not-a-bounce" },
      ])
    );

    const other = screen.getByRole("button", { name: "Other" });
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Never watch Exports/" })
    );
    expect(argsOf(calls, "reject_render")).toHaveLength(1);

    fireEvent.click(await screen.findByRole("button", { name: "Never watch" }));
    await waitFor(() =>
      expect(argsOf(calls, "reject_render")).toEqual([
        { id: 41, mode: "not-a-bounce" },
        { id: 41, mode: "never-here" },
      ])
    );
  });

  test("shows the app's refusal under the card", async () => {
    calls = mockApp(signedIn(), (command) => {
      if (command === "accept_render") throw "The hub refused the upload.";
    });
    show([card()]);

    fireEvent.click(screen.getByRole("button", { name: "Add as version" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The hub refused the upload."
    );
  });

  test("says why it is not added yet when the app has a message", () => {
    show([card({ message: "Waiting for the hub to answer." })]);

    expect(screen.getByText("Waiting for the hub to answer.")).toBeTruthy();
  });
});

describe("the card's other states", () => {
  test("uploading shows progress in place of the decisions", () => {
    show([
      card({
        state: "uploading",
        progress: { sent: 12 * MB, total: 48 * MB },
      }),
    ]);

    const bar = screen.getByRole("progressbar", { name: "Upload progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText(/Uploading 12 MB of 48 MB/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add as version" })).toBeNull();
  });

  test("uploading with no progress yet says so", () => {
    show([card({ state: "uploading", progress: null })]);

    expect(screen.getByText("Uploading\u2026")).toBeTruthy();
  });

  test("queued says it waits for the hub, with no decisions", () => {
    show([card({ state: "queued-offline" })]);

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Other" })).toBeNull();
  });

  test("added says Added as version and names the set", () => {
    show([card({ state: "added" })]);

    expect(screen.getByText(/Added as version/)).toBeTruthy();
    expect(screen.getByText(/to science123/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add as version" })).toBeNull();
  });

  test("over the limit merges copy, offers Add anyway and Raise limit", async () => {
    const went: unknown[] = [];
    const actions: PanelActions = {
      nav: "home",
      go: (to, tab) => went.push([to, tab]),
      back: () => undefined,
      report: () => undefined,
    };
    renderScreen(
      <PanelActionsProvider value={actions}>
        <RenderBand
          cards={[
            card({
              id: 9,
              state: "over-limit",
              message: "No file of it fits 40 MB.",
            }),
          ]}
        />
      </PanelActionsProvider>
    );

    expect(screen.getByText("No file of it fits 40 MB.")).toBeTruthy();
    expect(screen.queryByText("Over your size limit")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raise limit" }));
    expect(went).toEqual([["settings", "bounces"]]);

    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 9 }])
    );
    expect(screen.queryByRole("button", { name: "Add as version" })).toBeNull();
  });

  test("a pair is one card naming both files and the one it uploads", () => {
    show([pair()]);

    expect(items()).toHaveLength(1);
    const item = screen.getByRole("listitem", {
      name: "science123 v4.wav and .mp3",
    });
    expect(within(item).getByText("uploads the .wav (48 MB)")).toBeTruthy();
    expect(
      within(item).getByText(
        "Only the largest file under your size limit is uploaded."
      )
    ).toBeTruthy();
  });

  test("a pair over the limit says no file fits and still offers Add anyway", () => {
    show([pair({ state: "over-limit", uploadedFile: null })]);

    expect(screen.getByText("Over your size limit")).toBeTruthy();
    expect(screen.queryByText(/uploads the/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add anyway" })).toBeTruthy();
  });
});

describe("the player on a card", () => {
  test("starts a third of the way in and says pause while it plays", async () => {
    const playFrom = spyOn(previewPlayer, "playFrom").mockResolvedValue();
    show([card()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Play science123 v4.wav" })
    );

    expect(playFrom).toHaveBeenCalledTimes(1);
    expect(playFrom.mock.calls[0]?.[0]).toBe(
      "/Users/producer/Music/Exports/science123 v4.wav"
    );
    expect(playFrom.mock.calls[0]?.[1]).toBeCloseTo(1 / 3, 10);
    playFrom.mockRestore();
  });

  test("plays the file a pair uploads", () => {
    const playFrom = spyOn(previewPlayer, "playFrom").mockResolvedValue();
    show([pair()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Play science123 v4.wav and .mp3" })
    );

    expect(playFrom.mock.calls[0]?.[0]).toBe(
      "/Users/producer/Music/Exports/science123 v4.wav"
    );
    playFrom.mockRestore();
  });

  test("shows the position and length of the card it plays, pause, and clickable scrub bar", async () => {
    show([card()]);
    const path = "/Users/producer/Music/Exports/science123 v4.wav";
    const play = spyOn(previewPlayer, "getSnapshot").mockReturnValue({
      filePath: path,
      playing: true,
      currentTime: 72,
      duration: 222,
    });
    const seekFraction = spyOn(previewPlayer, "seekFraction").mockReturnValue();

    // Any transport change tells the cards to read the player again.
    previewPlayer.pause();

    expect(
      await screen.findByRole("button", { name: "Pause science123 v4.wav" })
    ).toBeTruthy();
    expect(screen.getByText("1:12 / 3:42")).toBeTruthy();
    const scrub = screen.getByRole("slider", { name: "Seek bounce preview" });
    spyOn(scrub, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 10,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(scrub, { clientX: 50 });
    expect(seekFraction).toHaveBeenCalledWith(0.25);
    seekFraction.mockRestore();
    play.mockRestore();
  });

  test("lets go of the player when the band leaves", () => {
    const release = spyOn(previewPlayer, "release");
    const { unmount } = show([card()]);

    unmount();

    expect(release).toHaveBeenCalled();
    release.mockRestore();
  });
});

describe("the list's keys", () => {
  test("holds one tab stop, on the cursor's card", () => {
    show([card({ id: 1 }), card({ id: 2 })]);

    const [first, second] = items();
    expect(first?.tabIndex).toBe(0);
    expect(second?.tabIndex).toBe(-1);
    expect(selected()).toBe("1");
  });

  test("moves the cursor and focus with the arrow keys, and stops at the ends", () => {
    show([card({ id: 1 }), card({ id: 2 }), card({ id: 3 })]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });
    expect(selected()).toBe("2");
    expect(focused()).toBe("2");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(selected()).toBe("3");
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    expect(selected()).toBe("3");

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    expect(selected()).toBe("2");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(selected()).toBe("1");
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    expect(selected()).toBe("1");
  });

  test("Y adds the cursor's render as a version", async () => {
    show([card({ id: 1 }), card({ id: 2 })]);
    const [first] = items();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "y" });

    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 2 }])
    );
  });

  test("N turns it down as not a bounce", async () => {
    show([card({ id: 5 })]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "N" });

    await waitFor(() =>
      expect(argsOf(calls, "reject_render")).toEqual([
        { id: 5, mode: "not-a-bounce" },
      ])
    );
  });

  test("Y and N do nothing on a card with no decision to make", () => {
    show([card({ state: "uploading", progress: null })]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "y" });
    fireEvent.keyDown(first as HTMLElement, { key: "n" });

    expect(calls.filter((c) => c.command.endsWith("_render"))).toEqual([]);
  });

  test("Space plays the cursor's render and pauses it again", () => {
    const playFrom = spyOn(previewPlayer, "playFrom").mockResolvedValue();
    show([card()]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: " " });

    expect(playFrom).toHaveBeenCalledTimes(1);
    playFrom.mockRestore();
  });

  test("Space on a button inside the card presses the button, not the player", () => {
    const playFrom = spyOn(previewPlayer, "playFrom").mockResolvedValue();
    show([card()]);
    const button = screen.getByRole("button", { name: "Not a bounce" });
    button.focus();

    fireEvent.keyDown(button, { key: " " });

    expect(playFrom).not.toHaveBeenCalled();
    playFrom.mockRestore();
  });

  test("steps through the loaded file with the left and right arrows from the card or Play button", () => {
    const path = "/Users/producer/Music/Exports/science123 v4.wav";
    const getSnapshot = spyOn(previewPlayer, "getSnapshot").mockReturnValue({
      filePath: path,
      playing: true,
      currentTime: 30,
      duration: 222,
    });
    const seekBy = spyOn(previewPlayer, "seekBy").mockReturnValue();
    show([card()]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowLeft" });

    const playBtn = screen.getByRole("button", {
      name: "Pause science123 v4.wav",
    });
    playBtn.focus();
    fireEvent.keyDown(playBtn, { key: "ArrowRight" });

    expect(seekBy.mock.calls.map((c) => c[0])).toEqual([10, -10, 10]);
    seekBy.mockRestore();
    getSnapshot.mockRestore();
  });

  test("leaves a key with a modifier to the panel's own keys", async () => {
    show([card()]);
    const [first] = items();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "y", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(argsOf(calls, "accept_render")).toEqual([]);
  });

  test("hands the cursor to the next card when one is decided away, and keeps focus in the list", async () => {
    const cards = [card({ id: 1 }), card({ id: 2 }), card({ id: 3 })];
    const { rerender } = show(cards);
    const [first] = items();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });
    expect(selected()).toBe("2");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "n" });
    await waitFor(() => expect(argsOf(calls, "reject_render")).toHaveLength(1));
    // The app drops the turned-down card from the snapshot, which takes the focused element with it.
    rerender(
      <Chrome nav="home">
        <RenderBand cards={[cards[0] as RenderCard, cards[2] as RenderCard]} />
      </Chrome>
    );

    expect(selected()).toBe("3");
    await waitFor(() => expect(focused()).toBe("3"));
  });

  test("syncs the cursor when an inner control of an inactive card receives focus", async () => {
    const secondPath = "/Users/producer/Music/Exports/second.wav";
    const getSnapshot = spyOn(previewPlayer, "getSnapshot").mockReturnValue({
      filePath: secondPath,
      playing: true,
      currentTime: 30,
      duration: 180,
    });
    const seekBy = spyOn(previewPlayer, "seekBy").mockReturnValue();

    show([
      card({
        id: 1,
        files: [{ path: "/Users/producer/Music/Exports/first.wav", size: 10 }],
      }),
      card({
        id: 2,
        files: [{ path: secondPath, size: 10 }],
      }),
    ]);

    expect(selected()).toBe("1");

    const secondPlay = screen.getByRole("button", { name: "Pause second.wav" });
    fireEvent.focus(secondPlay);

    expect(selected()).toBe("2");

    fireEvent.keyDown(secondPlay, { key: "ArrowRight" });
    expect(seekBy).toHaveBeenCalledWith(10);

    fireEvent.keyDown(secondPlay, { key: "y" });
    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 2 }])
    );

    seekBy.mockRestore();
    getSnapshot.mockRestore();
  });
});

describe("Wrong set", () => {
  async function openWrongSet(): Promise<void> {
    const other = screen.getByRole("button", { name: "Other" });
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Wrong set…" })
    );
  }

  test("lists the repo's other sets and adds the render to the one picked", async () => {
    show([
      card({
        id: 3,
        otherSets: [
          { sessionId: 55, name: "orchestral" },
          { sessionId: 56, name: "strings" },
        ],
      }),
    ]);

    await openWrongSet();
    const pick = await screen.findByRole("button", { name: "strings" });
    expect(screen.getByRole("button", { name: "orchestral" })).toBeTruthy();
    fireEvent.click(pick);

    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 3, session: 56 }])
    );
    expect(screen.queryByRole("button", { name: "strings" })).toBeNull();
  });

  test("says so when the folder has no other set on the hub", async () => {
    show([card({ otherSets: [] })]);

    await openWrongSet();

    expect(
      await screen.findByText("No other set in this folder is on the hub yet.")
    ).toBeTruthy();
  });

  test("keys typed in the picker are not the list's", async () => {
    show([card({ id: 3, otherSets: [{ sessionId: 55, name: "orchestral" }] })]);
    await openWrongSet();
    const pick = await screen.findByRole("button", { name: "orchestral" });

    fireEvent.keyDown(pick, { key: "y" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(argsOf(calls, "accept_render")).toEqual([]);
  });
});

describe("the contract fixture's renders", () => {
  test("draw as a proposed card, an uploading pair and a batch over the limit", () => {
    show(base.renders);

    expect(items()).toHaveLength(3);
    expect(
      screen.getByRole("listitem", { name: "science123 v4.wav" })
    ).toBeTruthy();
    const pairCard = screen.getByRole("listitem", { name: "Mix.mp3 and .wav" });
    expect(
      within(pairCard).getByText(/^uploads the \.wav \([\d.]+ MB\)$/)
    ).toBeTruthy();
    expect(
      within(pairCard).getByText(/Uploading [\d.]+ MB of [\d.]+ MB/)
    ).toBeTruthy();
    const over = screen.getByRole("listitem", { name: "Demo.wav" });
    expect(within(over).getByText("3 files")).toBeTruthy();
    expect(
      within(over).getByText("No file is under your 12 MB limit.")
    ).toBeTruthy();
    expect(
      within(over).getByRole("button", { name: "Raise limit" })
    ).toBeTruthy();
  });
});
