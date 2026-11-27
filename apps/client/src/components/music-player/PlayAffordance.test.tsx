import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const toggle = mock(async () => {});
const playInContext = mock(async () => {});
const queueNext = mock(async () => {});
const queueLast = mock(async () => {});

mock.module("@/components/music-player/use-playback", () => ({
  usePlayback: () => ({
    isLoaded: false,
    showPause: false,
    loading: false,
    toggle,
    playInContext,
    queueNext,
    queueLast,
  }),
}));

const { PlayAffordance } = await import("./PlayAffordance");

afterEach(() => {
  cleanup();
  for (const fn of [toggle, playInContext, queueNext, queueLast])
    fn.mockClear();
});

describe("PlayAffordance", () => {
  it("renders only the play button when hideMenu is set", () => {
    render(<PlayAffordance kind="track" id={7} title="Nocturne" hideMenu />);

    const play = screen.getByRole("button", { name: "Play Nocturne" });
    expect(play).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Playback options" })
    ).toBeNull();

    fireEvent.click(play);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the playback overflow menu by default for non-table callers", () => {
    render(<PlayAffordance kind="track" id={7} title="Nocturne" />);

    expect(screen.getByRole("button", { name: "Play Nocturne" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Playback options" })
    ).toBeTruthy();
  });
});
