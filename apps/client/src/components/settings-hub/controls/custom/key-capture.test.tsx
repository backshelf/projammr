import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { KeyCapture } from "./key-capture";

afterEach(cleanup);

const WINDOW_MS = 30;
const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function mount(chordWindowMs = WINDOW_MS) {
  const onCapture = mock<(combo: string) => void>();
  const onCancel = mock<() => void>();
  render(
    <KeyCapture
      apple={false}
      label="Next track"
      onCapture={onCapture}
      onCancel={onCancel}
      chordWindowMs={chordWindowMs}
      autoFocus
    />
  );
  return { field: screen.getByRole("button"), onCapture, onCancel };
}

describe("KeyCapture", () => {
  it("names itself for the command and takes focus when asked", () => {
    const { field } = mount();

    expect(field.getAttribute("aria-label")).toBe(
      "Press the new keys for Next track"
    );
    expect(document.activeElement).toBe(field);
  });

  it("captures a shifted letter as the canonical combo", () => {
    const { field, onCapture } = mount();

    fireEvent.keyDown(field, { key: "J", shiftKey: true });

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith("shift+j");
  });

  it("reads a letter typed under Caps Lock as shift+letter", () => {
    const { field, onCapture } = mount();

    fireEvent.keyDown(field, { key: "J" });

    expect(onCapture).toHaveBeenCalledWith("shift+j");
  });

  it("captures a modifier combo, a digit and a named key at once", () => {
    const { field, onCapture } = mount(10_000);

    fireEvent.keyDown(field, { key: "k", metaKey: true });
    fireEvent.keyDown(field, { key: "1" });
    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(onCapture.mock.calls.map(([combo]) => combo)).toEqual([
      "mod+k",
      "1",
      "ArrowDown",
    ]);
  });

  it("makes a chord of a bare letter and a second press inside the window", async () => {
    const { field, onCapture } = mount(10_000);

    fireEvent.keyDown(field, { key: "g" });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "c" });

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith("g c");
  });

  it("captures the bare letter when the window runs out", async () => {
    const { field, onCapture } = mount();

    fireEvent.keyDown(field, { key: "g" });
    expect(onCapture).not.toHaveBeenCalled();
    await wait(WINDOW_MS * 3);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith("g");
  });

  it("announces the pending letter and shows it as a cap", () => {
    const { field } = mount(10_000);

    fireEvent.keyDown(field, { key: "g" });

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("g, waiting for a second key");
    expect(field.querySelector("kbd")?.textContent).toBe("G");
  });

  it("keeps waiting through a bare modifier while a letter is pending", () => {
    const { field, onCapture } = mount(10_000);

    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "Shift", shiftKey: true });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "C", shiftKey: true });

    expect(onCapture).toHaveBeenCalledWith("g shift+c");
  });

  it("ignores an auto-repeated keydown so a held letter is not a chord", () => {
    const { field, onCapture } = mount(10_000);

    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "g", repeat: true });

    expect(onCapture).not.toHaveBeenCalled();
  });

  it("cancels on Escape and never captures it", () => {
    const { field, onCapture, onCancel } = mount();

    fireEvent.keyDown(field, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("cancels on Escape while a letter is pending and drops the letter", async () => {
    const { field, onCapture, onCancel } = mount();

    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "Escape" });
    await wait(WINDOW_MS * 3);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("captures nothing for a bare modifier, Caps Lock or a dead key", async () => {
    const { field, onCapture, onCancel } = mount();

    for (const key of ["Shift", "Control", "Meta", "Alt", "CapsLock", "Dead"]) {
      fireEvent.keyDown(field, { key });
    }
    await wait(WINDOW_MS * 3);

    expect(onCapture).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("consumes every key it handles so the window keymap skips it", () => {
    const { field } = mount();
    const seen: boolean[] = [];
    const onWindow = (event: KeyboardEvent) =>
      seen.push(event.defaultPrevented);
    window.addEventListener("keydown", onWindow);

    // The window listener is the bubbling path the keymap listens on.
    fireEvent.keyDown(field, { key: "Shift" });
    fireEvent.keyDown(field, { key: "j" });
    fireEvent.keyDown(field, { key: "Escape" });
    window.removeEventListener("keydown", onWindow);

    expect(seen).toEqual([]);
  });

  it("marks a captured key as defaultPrevented", () => {
    const { field } = mount(10_000);

    expect(fireEvent.keyDown(field, { key: "k", metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(field, { key: "Shift" })).toBe(false);
  });

  it("lets Tab through so focus can leave", () => {
    const { field, onCapture, onCancel } = mount();

    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Tab", shiftKey: true })).toBe(true);

    expect(onCapture).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels and drops a pending letter when focus leaves", async () => {
    const { field, onCapture, onCancel } = mount();

    fireEvent.keyDown(field, { key: "g" });
    fireEvent.blur(field);
    await wait(WINDOW_MS * 3);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });
});
