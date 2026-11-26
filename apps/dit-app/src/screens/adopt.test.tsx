import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { AdoptOffer } from "../ipc";
import { argsOf, base, mockApp, renderScreen, teardown } from "../test-support";
import { Chrome } from "../test-chrome";
import { Adopt } from "./adopt";

afterEach(teardown);

const offer = base.adoptOffer as AdoptOffer;

describe("Adopt", () => {
  test("asks whether to track the project and says what that keeps", () => {
    mockApp(base);
    renderScreen(<Adopt offer={offer} />);

    expect(
      screen.getByRole("heading", { name: "Track this project?" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "new Project has 8 sets. dit keeps every save and lets you name the ones that matter."
      )
    ).toBeTruthy();
    expect(screen.getByText("Album")).toBeTruthy();
  });

  test("warns about a synced folder, and says nothing when it is not", () => {
    mockApp(base);
    const { unmount } = renderScreen(<Adopt offer={offer} />);
    expect(
      screen.getByText(
        "This folder is synced by Dropbox. Two computers sharing one repo will corrupt it."
      )
    ).toBeTruthy();
    unmount();

    renderScreen(<Adopt offer={{ ...offer, syncedBy: null, setCount: 1 }} />);
    expect(screen.queryByText(/synced by/)).toBeNull();
    expect(screen.getByText(/new Project has 1 set\./)).toBeTruthy();
  });

  test("Track it adopts the folder into the project last used", async () => {
    const calls = mockApp(base);
    renderScreen(<Adopt offer={offer} />);

    fireEvent.click(screen.getByRole("button", { name: "Track it" }));

    await waitFor(() =>
      expect(argsOf(calls, "adopt")).toEqual([
        { folder: "/Users/me/Music/new Project", projectId: 4 },
      ])
    );
  });

  test("Track it adopts into the project that was picked instead", async () => {
    const calls = mockApp(base);
    renderScreen(<Adopt offer={offer} />);

    fireEvent.click(screen.getByRole("combobox"));
    const choice = await screen.findByRole("option", { name: "EP" });
    fireEvent.pointerDown(choice);
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Track it" }));

    await waitFor(() =>
      expect(argsOf(calls, "adopt")).toEqual([
        { folder: "/Users/me/Music/new Project", projectId: 7 },
      ])
    );
  });

  test("waits for a project when none was used last and there are several", () => {
    mockApp(base);
    renderScreen(<Adopt offer={{ ...offer, projectId: null }} />);

    const track = screen.getByRole("button", {
      name: "Track it",
    }) as HTMLButtonElement;
    expect(track.disabled).toBe(true);
  });

  test("takes up the project list the app reads from the hub after the offer appears", () => {
    mockApp(base);
    const noProjects = { ...offer, projectId: null, projects: [] };
    const { rerender } = renderScreen(<Adopt offer={noProjects} />);
    const track = (): HTMLButtonElement =>
      screen.getByRole("button", { name: "Track it" });
    expect(track().disabled).toBe(true);

    rerender(
      <Chrome nav="home">
        <Adopt offer={{ ...noProjects, projects: [{ id: 9, name: "Solo" }] }} />
      </Chrome>
    );

    expect(track().disabled).toBe(false);
  });

  test("starts on the only project there is", () => {
    mockApp(base);
    renderScreen(
      <Adopt
        offer={{
          ...offer,
          projectId: null,
          projects: [{ id: 9, name: "Solo" }],
        }}
      />
    );

    const track = screen.getByRole("button", {
      name: "Track it",
    }) as HTMLButtonElement;
    expect(track.disabled).toBe(false);
  });

  test("Not now declines the folder", async () => {
    const calls = mockApp(base);
    renderScreen(<Adopt offer={offer} />);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() =>
      expect(argsOf(calls, "decline_folder")).toEqual([
        { folder: "/Users/me/Music/new Project" },
      ])
    );
  });

  test("shows why the app refused to track it", async () => {
    mockApp(base, (command) => {
      if (command === "adopt") throw "That folder is already tracked.";
    });
    renderScreen(<Adopt offer={offer} />);

    fireEvent.click(screen.getByRole("button", { name: "Track it" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That folder is already tracked."
    );
  });
});
