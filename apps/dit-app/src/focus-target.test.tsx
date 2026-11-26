import { useState, type JSX } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emit, TauriEvent } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { waitFor } from "@workspace/test/wait-for";

import { useFocusOnShow } from "./focus-target";

afterEach(() => {
  cleanup();
  clearMocks();
});

/** A stub screen: a field that claims focus-on-show, a button that does not, and a switch that drops the field. */
function Stub(): JSX.Element {
  const claim = useFocusOnShow();
  const [claimed, setClaimed] = useState(true);
  return (
    <>
      {claimed && <input aria-label="Commit message" ref={claim} />}
      <button onClick={() => setClaimed(false)}>Drop the field</button>
    </>
  );
}

/** Emits the window's focus event until the hook's listener, which registers asynchronously, has heard it. */
async function showPanel(heard: () => void): Promise<void> {
  await waitFor(async () => {
    await emit(TauriEvent.WINDOW_FOCUS);
    heard();
  });
}

describe("useFocusOnShow", () => {
  test("focuses the claimed field each time the window takes focus", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    render(<Stub />);
    const field = screen.getByLabelText("Commit message");
    screen.getByRole("button").focus();

    await showPanel(() => expect(document.activeElement).toBe(field));

    screen.getByRole("button").focus();
    await emit(TauriEvent.WINDOW_FOCUS);
    expect(document.activeElement).toBe(field);
  });

  test("leaves focus where it is once the field is gone", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    render(<Stub />);
    const field = screen.getByLabelText("Commit message");
    await showPanel(() => expect(document.activeElement).toBe(field));
    const button = screen.getByRole("button");
    fireEvent.click(button);
    button.focus();

    await emit(TauriEvent.WINDOW_FOCUS);

    expect(document.activeElement).toBe(button);
  });
});
