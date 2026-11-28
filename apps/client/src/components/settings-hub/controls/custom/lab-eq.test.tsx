import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { RACK_DEFAULT, type RackDefault } from "@workspace/settings/groups/lab";
import { EqCurveOverlay } from "@/components/lab/EqCurveOverlay";
import { RackBand } from "@/components/lab/RackBand";
import { DEFAULT_LAB, type EqBand } from "@/lib/dsp/lab-settings";
import { LabEqControl } from "./lab-eq";

afterEach(cleanup);

type EqValue = { on: boolean; bands: EqBand[] } | RackDefault;

// The registry types `control` as the full `SettingControl` union; the
// dispatcher (`controls/index.ts`) narrows it with the same cast, since the
// definition's `schema` is what actually pairs a value with its control.
const definition = SETTINGS["lab.eqPreset"] as unknown as Parameters<
  typeof LabEqControl
>[0]["definition"];

function renderControl(value: EqValue, onChange = mock(), disabled = false) {
  render(
    <LabEqControl
      definition={definition}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="lab-eq"
    />
  );
  return onChange;
}

describe("LabEqControl", () => {
  it("renders the rack default, marked as such", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.getByText("Rack default")).toBeTruthy();
    // Band 1 (index 0) starts off, so the curve draws no handle for it;
    // band 2 is the rack default's first active slot.
    expect(
      screen
        .getByRole("slider", { name: "EQ band 2" })
        .getAttribute("aria-valuenow")
    ).toBe(String(Math.round(DEFAULT_LAB.rack.eq.bands[1]!.gainDb * 10) / 10));
  });

  it("has no Reset button while the value is the rack default", () => {
    renderControl(RACK_DEFAULT);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("writes the whole object, with one field changed, on the first edit", () => {
    const onChange = mock();
    renderControl(RACK_DEFAULT, onChange);
    const band2 = screen.getByRole("slider", { name: "EQ band 2" });
    band2.focus();
    band2.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
    );
    const [written] = onChange.mock.calls.at(-1)!;
    expect(written.on).toBe(DEFAULT_LAB.rack.eq.on);
    expect(written.bands[1].gainDb).not.toBe(
      DEFAULT_LAB.rack.eq.bands[1]!.gainDb
    );
    expect(written.bands[0]).toEqual(DEFAULT_LAB.rack.eq.bands[0]);
    expect(written.bands.slice(2)).toEqual(DEFAULT_LAB.rack.eq.bands.slice(2));
  });

  it("renders no enabled input or drag handle and ignores interaction while disabled", () => {
    const onChange = mock();
    renderControl({ ...DEFAULT_LAB.rack.eq, on: true }, onChange, true);
    for (const input of screen.getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    const handle = screen.getByRole("slider", { name: "EQ band 2" });
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(handle.getAttribute("tabindex")).toBeNull();
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
    );
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 10 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the handles focusable and editable when disabled is absent", () => {
    const onChange = mock();
    render(
      <EqCurveOverlay
        bands={DEFAULT_LAB.rack.eq.bands}
        onChangeBand={onChange}
      />
    );
    const handle = screen.getByRole("slider", { name: "EQ band 2" });
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-disabled")).toBeNull();
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    cleanup();
    render(
      <RackBand
        index={1}
        band={DEFAULT_LAB.rack.eq.bands[1]!}
        onChange={onChange}
      />
    );
    const q = screen.getByRole("spinbutton", { name: "Band 2 Q" });
    expect((q as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(q, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("writes the rack default, never null, from Reset", () => {
    const onChange = mock();
    renderControl({ ...DEFAULT_LAB.rack.eq, on: true }, onChange);
    screen.getByRole("button", { name: "Reset" }).click();
    expect(onChange).toHaveBeenCalledWith(RACK_DEFAULT);
  });

  it("uses responsive width and folds the 8 bands behind a disclosure on mobile", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    try {
      renderControl({ ...DEFAULT_LAB.rack.eq, on: true });
      const group = screen.getByRole("group");
      expect(group.className).toContain("w-full");
      expect(group.className).toContain("max-w-80");

      const disclosure = screen.getByRole("button", { name: "Bands (8)" });
      expect(disclosure.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);

      fireEvent.click(disclosure);
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: originalWidth,
      });
    }
  });
});
