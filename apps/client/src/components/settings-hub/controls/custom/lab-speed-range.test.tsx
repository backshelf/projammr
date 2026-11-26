import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { RACK_DEFAULT } from "@workspace/settings/groups/lab";
import { LabSpeedRangeControl } from "./lab-speed-range";
import type { LabRange } from "./lab-range-control";

afterEach(cleanup);

// The registry types `control` as the full `SettingControl` union; the
// dispatcher (`controls/index.ts`) narrows it with the same cast, since the
// definition's `schema` is what actually pairs a value with its control.
const definition = SETTINGS["lab.speedRange"] as unknown as Parameters<
  typeof LabSpeedRangeControl
>[0]["definition"];

function renderControl(value: LabRange, onChange = mock()) {
  render(
    <LabSpeedRangeControl
      definition={definition}
      value={value}
      onChange={onChange}
      disabled={false}
      id="lab-speed-range"
    />
  );
  return onChange;
}

describe("LabSpeedRangeControl", () => {
  it("renders the full range from the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.getByText("0.50× – 2.00×")).toBeTruthy();
    expect(
      screen
        .getByRole("slider", { name: "Minimum speed" })
        .getAttribute("aria-valuenow")
    ).toBe("0.5");
    expect(
      screen
        .getByRole("slider", { name: "Maximum speed" })
        .getAttribute("aria-valuenow")
    ).toBe("2");
  });

  it("has no Reset button while the value is the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("writes a clamped object on a change", () => {
    const onChange = mock();
    renderControl(RACK_DEFAULT, onChange);
    const minThumb = screen.getByRole("slider", { name: "Minimum speed" });
    minThumb.focus();
    minThumb.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    );
    expect(onChange).toHaveBeenCalledWith({ min: 0.51, max: 2 });
  });

  it("writes the rack default, never null, from Reset", () => {
    const onChange = mock();
    renderControl({ min: 0.8, max: 1.5 }, onChange);
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onChange).toHaveBeenCalledWith(RACK_DEFAULT);
  });
});
