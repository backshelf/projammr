import { afterEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import type { SetMeta } from "../ipc";
import { base } from "../test-support";
import { SkylineReadout } from "./skyline-readout";
import { skylineStructure } from "./skyline-model";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-motion");
});

const structure = skylineStructure({
  head: base.headMeta as SetMeta,
  latest: base.latestMeta as SetMeta,
  live: null,
  changed: [],
})!;

function showReadout(): HTMLElement {
  render(<SkylineReadout structure={structure} committed />);
  return screen.getByRole("group", { name: "The set's tracks" });
}

/** The line the readout speaks, which a screen reader hears as it changes. */
function spoken(): string {
  return document.querySelector("[aria-live]")?.textContent ?? "";
}

const bars = (): Element[] => [...document.querySelectorAll("[data-diff-bar]")];

describe("SkylineReadout", () => {
  test("lights the changed tracks and leaves the rest unmarked", () => {
    showReadout();

    expect(bars().map((bar) => bar.getAttribute("data-mark"))).toEqual([
      null,
      "changed",
      "added",
      null,
    ]);
  });

  test("dims the unchanged tracks, in the Changes mode of the save diff", () => {
    const group = showReadout();

    expect(group.getAttribute("data-mode")).toBe("changes");
    expect(group.className).toContain("group/save-diff");
  });

  test("says how many tracks are lit until one is pointed at", () => {
    showReadout();

    expect(spoken()).toBe("2 tracks changed since the last commit");
  });

  test("is one tab stop, and the bars are not stops of their own", () => {
    const group = showReadout();
    const stops = document.querySelectorAll("[tabindex]");

    expect([...stops]).toEqual([group]);
    expect(bars().some((bar) => bar.hasAttribute("tabindex"))).toBe(false);
  });

  test("names the first lit track when it takes focus", () => {
    const group = showReadout();
    act(() => group.focus());

    expect(spoken()).toBe("Bass \u00b7 +EQ Eight");
    expect(
      document.querySelector('[data-diff-bar="1"]')?.hasAttribute("data-hot")
    ).toBe(true);
  });

  test("moves across the tracks with the arrows, Home and End, and stops at the ends", () => {
    const group = showReadout();
    act(() => group.focus());

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(spoken()).toBe("Pad \u00b7 added");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(spoken()).toBe("Master");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(spoken()).toBe("Master");
    fireEvent.keyDown(group, { key: "Home" });
    expect(spoken()).toBe("Drums \u00b7 1 device");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(spoken()).toBe("Drums \u00b7 1 device");
    fireEvent.keyDown(group, { key: "End" });
    expect(spoken()).toBe("Master");
  });

  test("lights the track it names and no other", () => {
    const group = showReadout();
    act(() => group.focus());
    fireEvent.keyDown(group, { key: "ArrowRight" });

    const hot = bars().filter((bar) => bar.hasAttribute("data-hot"));
    expect(hot.map((bar) => bar.getAttribute("data-diff-bar"))).toEqual(["2"]);
    expect(group.hasAttribute("data-hot")).toBe(true);
  });

  test("leaves a key that is not its own to the page", () => {
    const group = showReadout();
    act(() => group.focus());

    const tab = fireEvent.keyDown(group, { key: "Tab" });
    const shifted = fireEvent.keyDown(group, {
      key: "ArrowRight",
      metaKey: true,
    });

    expect(tab).toBe(true);
    expect(shifted).toBe(true);
    expect(spoken()).toBe("Bass \u00b7 +EQ Eight");
  });

  test("names the track pointed at, and goes back to the count when the pointer leaves", () => {
    const group = showReadout();

    fireEvent.pointerOver(bars()[2]!);
    expect(spoken()).toBe("Pad \u00b7 added");
    expect(group.hasAttribute("data-hot")).toBe(true);

    fireEvent.pointerLeave(group);
    expect(spoken()).toBe("2 tracks changed since the last commit");
    expect(group.hasAttribute("data-hot")).toBe(false);
    expect(bars().some((bar) => bar.hasAttribute("data-hot"))).toBe(false);
  });

  test("lets go of the track when focus leaves", () => {
    const group = showReadout();
    act(() => group.focus());
    expect(group.hasAttribute("data-hot")).toBe(true);
    act(() => group.blur());

    expect(spoken()).toBe("2 tracks changed since the last commit");
    expect(group.hasAttribute("data-hot")).toBe(false);
  });

  test("under reduced motion the fade goes and the lit tracks stay lit", () => {
    const group = showReadout();
    expect(group.hasAttribute("data-reduced-motion")).toBe(false);
    cleanup();

    document.documentElement.setAttribute("data-motion", "reduce");
    const reduced = showReadout();

    expect(reduced.hasAttribute("data-reduced-motion")).toBe(true);
    expect(bars().map((bar) => bar.getAttribute("data-mark"))).toEqual([
      null,
      "changed",
      "added",
      null,
    ]);
  });

  test("says the set is not committed yet when it has no commit", () => {
    render(<SkylineReadout structure={structure} committed={false} />);

    expect(spoken()).toBe("4 tracks, none committed yet");
  });

  test("shows every track whole, none dimmed, when nothing is lit", () => {
    const quiet = skylineStructure({
      head: base.headMeta as SetMeta,
      latest: base.headMeta as SetMeta,
      live: null,
      changed: [],
    })!;
    render(<SkylineReadout structure={quiet} committed />);

    const group = screen.getByRole("group", { name: "The set's tracks" });
    expect(group.getAttribute("data-mode")).toBe("whole");
    expect(spoken()).toBe("No track has changed since the last commit");
  });
});
