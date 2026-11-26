import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useThemeHotkey } from "./theme-provider";

function Hotkey({ toggle }: { toggle: () => void }) {
  useThemeHotkey(toggle);
  return <input aria-label="field" />;
}

afterEach(cleanup);

describe("useThemeHotkey", () => {
  it("toggles on a bare d", () => {
    const toggle = mock();
    render(<Hotkey toggle={toggle} />);
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "D" });
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("ignores d with a modifier, on repeat, or already handled", () => {
    const toggle = mock();
    render(<Hotkey toggle={toggle} />);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", altKey: true });
    fireEvent.keyDown(window, { key: "d", repeat: true });
    const handled = new KeyboardEvent("keydown", {
      key: "d",
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("ignores d typed into a text field and other keys", () => {
    const toggle = mock();
    const { getByLabelText } = render(<Hotkey toggle={toggle} />);
    fireEvent.keyDown(getByLabelText("field"), { key: "d" });
    fireEvent.keyDown(window, { key: "e" });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const toggle = mock();
    const { unmount } = render(<Hotkey toggle={toggle} />);
    unmount();
    fireEvent.keyDown(window, { key: "d" });
    expect(toggle).not.toHaveBeenCalled();
  });
});
