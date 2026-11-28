import { afterEach, describe, expect, test } from "bun:test";
import { screen, within } from "@testing-library/react";

import type { Adopting as AdoptingState } from "../ipc";
import { mockApp, renderScreen, signedIn, teardown } from "../test-support";
import { Adopting } from "./adopting";

afterEach(teardown);

const adopting: AdoptingState = {
  folder: "/Users/me/Music/science Project",
  name: "science Project",
  setCount: 3,
  sets: [
    { name: "science123", state: "saved" },
    { name: "science124", state: "saving" },
  ],
};

function show(state: AdoptingState): void {
  mockApp(signedIn({ adopting: state }));
  renderScreen(<Adopting adopting={state} />);
}

describe("Adopting", () => {
  test("names the folder and lists each set as saving or saved", () => {
    show(adopting);

    expect(
      screen.getByRole("heading", { name: "Tracking science Project" })
    ).toBeTruthy();
    const rows = within(
      screen.getByRole("list", { name: "Sets in the folder" })
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "science123Saved",
      "science124Saving…",
    ]);
  });

  test("counts the sets saved of the sets the folder holds", () => {
    show(adopting);

    expect(screen.getByRole("status").textContent).toBe("1 of 3 sets saved");
  });

  test("says every set is saved once the last one lands", () => {
    show({
      ...adopting,
      setCount: 2,
      sets: adopting.sets.map((set) => ({ ...set, state: "saved" })),
    });

    expect(screen.getByRole("status").textContent).toBe("All 2 sets saved");
  });

  test("draws no list before the first set starts and renders a progress bar", () => {
    show({ ...adopting, sets: [] });

    expect(
      screen.getByRole("progressbar", { name: "Tracking progress" })
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("0 of 3 sets saved");
    expect(screen.queryByRole("list")).toBeNull();
  });
});
