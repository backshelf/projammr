import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { RACK_DEFAULT, type RackDefault } from "@workspace/settings/groups/lab";
import { DEFAULT_LAB, type ReverbSettings } from "@/lib/dsp/lab-settings";
import { LabReverbControl } from "./lab-reverb";

afterEach(cleanup);

// The registry types `control` as the full `SettingControl` union; the
// dispatcher (`controls/index.ts`) narrows it with the same cast, since the
// definition's `schema` is what actually pairs a value with its control.
const definition = SETTINGS["lab.reverb"] as unknown as Parameters<
  typeof LabReverbControl
>[0]["definition"];

function renderControl(
  value: ReverbSettings | RackDefault,
  onChange = mock(),
  disabled = false
) {
  render(
    <LabReverbControl
      definition={definition}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="lab-reverb"
    />
  );
  return onChange;
}

describe("LabReverbControl", () => {
  it("renders the rack default, marked as such", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.getByText("Rack default")).toBeTruthy();
    expect(
      screen
        .getByRole("slider", { name: "Reverb amount" })
        .getAttribute("aria-valuenow")
    ).toBe(String(DEFAULT_LAB.rack.reverb.wet));
  });

  it("has no Reset button while the value is the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("writes the whole object, with one field changed, on the first edit", () => {
    const onChange = mock();
    renderControl(RACK_DEFAULT, onChange);
    const wet = screen.getByRole("slider", { name: "Reverb amount" });
    wet.focus();
    wet.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAB.rack.reverb,
      wet: DEFAULT_LAB.rack.reverb.wet + 0.01,
    });
  });

  it("renders no enabled control and ignores clicks while disabled", () => {
    const onChange = mock();
    renderControl({ ...DEFAULT_LAB.rack.reverb, on: true }, onChange, true);
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider.getAttribute("aria-disabled") ?? "true").toBe("true");
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes the rack default, never null, from Reset", () => {
    const onChange = mock();
    renderControl({ ...DEFAULT_LAB.rack.reverb, on: true }, onChange);
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onChange).toHaveBeenCalledWith(RACK_DEFAULT);
  });
});
