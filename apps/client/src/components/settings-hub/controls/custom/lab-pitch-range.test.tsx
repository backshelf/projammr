import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { RACK_DEFAULT } from "@workspace/settings/groups/lab";
import { LabPitchRangeControl } from "./lab-pitch-range";
import type { LabRange } from "./lab-range-control";

afterEach(cleanup);

// The registry types `control` as the full `SettingControl` union; the
// dispatcher (`controls/index.ts`) narrows it with the same cast, since the
// definition's `schema` is what actually pairs a value with its control.
const definition = SETTINGS["lab.pitchRange"] as unknown as Parameters<
  typeof LabPitchRangeControl
>[0]["definition"];

function renderControl(value: LabRange, onChange = mock()) {
  render(
    <LabPitchRangeControl
      definition={definition}
      value={value}
      onChange={onChange}
      disabled={false}
      id="lab-pitch-range"
    />
  );
  return onChange;
}

describe("LabPitchRangeControl", () => {
  it("renders the full range from the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.getByText("−12 st – +12 st")).toBeTruthy();
    expect(
      screen
        .getByRole("slider", { name: "Minimum pitch" })
        .getAttribute("aria-valuenow")
    ).toBe("-12");
    expect(
      screen
        .getByRole("slider", { name: "Maximum pitch" })
        .getAttribute("aria-valuenow")
    ).toBe("12");
  });

  it("has no Reset button while the value is the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("writes a clamped object on a change", () => {
    const onChange = mock();
    renderControl(RACK_DEFAULT, onChange);
    const minThumb = screen.getByRole("slider", { name: "Minimum pitch" });
    minThumb.focus();
    minThumb.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    );
    expect(onChange).toHaveBeenCalledWith({ min: -11, max: 12 });
  });

  it("writes the rack default, never null, from Reset", () => {
    const onChange = mock();
    renderControl({ min: -5, max: 5 }, onChange);
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onChange).toHaveBeenCalledWith(RACK_DEFAULT);
  });
});
