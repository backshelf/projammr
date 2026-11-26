import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { RACK_DEFAULT, type RackDefault } from "@workspace/settings/groups/lab";
import { DEFAULT_LAB, type CompSettings } from "@/lib/dsp/lab-settings";
import { LabCompressorControl } from "./lab-compressor";

afterEach(cleanup);

// The registry types `control` as the full `SettingControl` union; the
// dispatcher (`controls/index.ts`) narrows it with the same cast, since the
// definition's `schema` is what actually pairs a value with its control.
const definition = SETTINGS["lab.compressor"] as unknown as Parameters<
  typeof LabCompressorControl
>[0]["definition"];

function renderControl(value: CompSettings | RackDefault, onChange = mock()) {
  render(
    <LabCompressorControl
      definition={definition}
      value={value}
      onChange={onChange}
      disabled={false}
      id="lab-compressor"
    />
  );
  return onChange;
}

describe("LabCompressorControl", () => {
  it("renders the rack default, marked as such", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.getByText("Rack default")).toBeTruthy();
    expect(
      screen
        .getByRole("slider", { name: "Threshold" })
        .getAttribute("aria-valuenow")
    ).toBe(String(DEFAULT_LAB.rack.comp.thresholdDb));
  });

  it("has no Reset button while the value is the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("writes the whole object, with one field changed, on the first edit", () => {
    const onChange = mock();
    renderControl(RACK_DEFAULT, onChange);
    const threshold = screen.getByRole("slider", { name: "Threshold" });
    threshold.focus();
    threshold.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAB.rack.comp,
      thresholdDb: DEFAULT_LAB.rack.comp.thresholdDb + 0.5,
    });
  });

  it("writes the rack default, never null, from Reset", () => {
    const onChange = mock();
    renderControl({ ...DEFAULT_LAB.rack.comp, on: true }, onChange);
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onChange).toHaveBeenCalledWith(RACK_DEFAULT);
  });
});
