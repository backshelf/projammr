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
const options = (): HTMLElement[] => screen.getAllByRole("option");
const selected = (): string | null =>
  options().find((option) => option.getAttribute("aria-selected") === "true")
    ?.dataset.render ?? null;

describe("the band", () => {
  test("is nothing at all with no card, and nothing for a render still held back", () => {
    const { container, rerender } = show([]);
    expect(container.querySelector("[role=listbox]")).toBeNull();
    expect(screen.queryByText("New bounce")).toBeNull();

    rerender(<RenderBand cards={[card({ state: "waiting" })]} />);
    expect(container.querySelector("[role=listbox]")).toBeNull();
  });

  test("heads the cards with the label-shape heading and counts more than one", () => {
    show([card({ id: 1 }), card({ id: 2 })]);

    const heading = screen.getByRole("heading", { name: /New bounce/ });
    expect(heading.textContent).toContain("New bounce");
    expect(heading.textContent).toContain("2");
    expect(screen.getByRole("listbox", { name: /New bounce/ })).toBeTruthy();
  });
});

describe("a proposed card", () => {
  test("names the file whole, its folder, its facts and its reasons in words", () => {
    show([card()]);

    const option = screen.getByRole("option", { name: "science123 v4.wav" });
    expect(within(option).getByText("science123 v4.wav")).toBeTruthy();
    expect(
      within(option).getByText("/Users/producer/Music/Exports")
    ).toBeTruthy();
    expect(within(option).getByText("3:42")).toBeTruthy();
    expect(within(option).getByText("48 MB")).toBeTruthy();
    expect(
      within(option).getByText("bounced 4 min after your last save")
    ).toBeTruthy();
    expect(
      within(option).getByText(
        "named like the set \u00b7 in its folder \u00b7 4 min after your last save"
      )
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

  test("offers the four decisions and the play control", () => {
    show([card()]);

    for (const name of [
      "Add as version",
      "Not this set",
      "Not a bounce",
      "Never here",
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

  test("turns it down as not a bounce, or never here", async () => {
    show([card({ id: 41 })]);

    fireEvent.click(screen.getByRole("button", { name: "Not a bounce" }));
    await waitFor(() =>
      expect(argsOf(calls, "reject_render")).toEqual([
        { id: 41, mode: "not-a-bounce" },
      ])
    );

    fireEvent.click(screen.getByRole("button", { name: "Never here" }));
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
    expect(screen.queryByRole("button", { name: "Never here" })).toBeNull();
  });

  test("added says Added as version and names the set", () => {
    show([card({ state: "added" })]);

    expect(screen.getByText(/Added as version/)).toBeTruthy();
    expect(screen.getByText(/to science123/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add as version" })).toBeNull();
  });

  test("over the limit says so and offers Add anyway", async () => {
    show([
      card({
        id: 9,
        state: "over-limit",
        message: "No file of it fits 40 MB.",
      }),
    ]);

    expect(screen.getByText("Over your size limit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 9 }])
    );
    expect(screen.queryByRole("button", { name: "Add as version" })).toBeNull();
  });

  test("a pair is one card naming both files and the one it uploads", () => {
    show([pair()]);

    expect(options()).toHaveLength(1);
    const option = screen.getByRole("option", {
      name: "science123 v4.wav and .mp3",
    });
    expect(within(option).getByText("uploads the .wav (48 MB)")).toBeTruthy();
    expect(
      within(option).getByText(
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

  test("shows the position and length of the card it plays, and pause", async () => {
    show([card()]);
    const path = "/Users/producer/Music/Exports/science123 v4.wav";
    const play = spyOn(previewPlayer, "getSnapshot").mockReturnValue({
      filePath: path,
      playing: true,
      currentTime: 72,
      duration: 222,
    });

    // Any transport change tells the cards to read the player again.
    previewPlayer.pause();

    expect(
      await screen.findByRole("button", { name: "Pause science123 v4.wav" })
    ).toBeTruthy();
    expect(screen.getByText("1:12 / 3:42")).toBeTruthy();
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

describe("the listbox's keys", () => {
  test("holds one tab stop, on the cursor's card", () => {
    show([card({ id: 1 }), card({ id: 2 })]);

    const [first, second] = options();
    expect(first?.tabIndex).toBe(0);
    expect(second?.tabIndex).toBe(-1);
    expect(selected()).toBe("1");
  });

  test("moves the cursor and focus with the arrow keys, and stops at the ends", () => {
    show([card({ id: 1 }), card({ id: 2 }), card({ id: 3 })]);
    const [first] = options();
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
    const [first] = options();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "y" });

    await waitFor(() =>
      expect(argsOf(calls, "accept_render")).toEqual([{ id: 2 }])
    );
  });

  test("N turns it down as not a bounce", async () => {
    show([card({ id: 5 })]);
    const [first] = options();
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
    const [first] = options();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "y" });
    fireEvent.keyDown(first as HTMLElement, { key: "n" });

    expect(calls.filter((c) => c.command.endsWith("_render"))).toEqual([]);
  });

  test("Space plays the cursor's render and pauses it again", () => {
    const playFrom = spyOn(previewPlayer, "playFrom").mockResolvedValue();
    show([card()]);
    const [first] = options();
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

  test("steps through the loaded file with the left and right arrows", () => {
    const path = "/Users/producer/Music/Exports/science123 v4.wav";
    spyOn(previewPlayer, "getSnapshot").mockReturnValue({
      filePath: path,
      playing: true,
      currentTime: 30,
      duration: 222,
    });
    const seekBy = spyOn(previewPlayer, "seekBy").mockReturnValue();
    show([card()]);
    const [first] = options();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowLeft" });

    expect(seekBy.mock.calls.map((c) => c[0])).toEqual([10, -10]);
  });

  test("leaves a key with a modifier to the panel's own keys", async () => {
    show([card()]);
    const [first] = options();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "y", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(argsOf(calls, "accept_render")).toEqual([]);
  });

  test("hands the cursor to the next card when one is decided away, and keeps focus in the list", async () => {
    const cards = [card({ id: 1 }), card({ id: 2 }), card({ id: 3 })];
    const { rerender } = show(cards);
    const [first] = options();
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
});

describe("Not this set", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Not this set" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Not this set" }));

    expect(
      await screen.findByText("No other set in this folder is on the hub yet.")
    ).toBeTruthy();
  });

  test("keys typed in the picker are not the list's", async () => {
    show([card({ id: 3, otherSets: [{ sessionId: 55, name: "orchestral" }] })]);
    fireEvent.click(screen.getByRole("button", { name: "Not this set" }));
    const pick = await screen.findByRole("button", { name: "orchestral" });

    fireEvent.keyDown(pick, { key: "y" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(argsOf(calls, "accept_render")).toEqual([]);
  });
});

describe("the contract fixture's renders", () => {
  test("draw as a proposed card, an uploading pair and a batch over the limit", () => {
    show(base.renders);

    expect(options()).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "science123 v4.wav" })
    ).toBeTruthy();
    const pairCard = screen.getByRole("option", { name: "Mix.mp3 and .wav" });
    expect(
      within(pairCard).getByText(/^uploads the \.wav \([\d.]+ MB\)$/)
    ).toBeTruthy();
    expect(
      within(pairCard).getByText(/Uploading [\d.]+ MB of [\d.]+ MB/)
    ).toBeTruthy();
    const over = screen.getByRole("option", { name: "Demo.wav" });
    expect(within(over).getByText("3 files")).toBeTruthy();
    expect(within(over).getByText("Over your size limit")).toBeTruthy();
    expect(
      within(over).getByText("No file is under your 12 MB limit.")
    ).toBeTruthy();
  });
});
