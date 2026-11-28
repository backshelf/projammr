import { EqCurveOverlay } from "@/components/lab/EqCurveOverlay";
import { DEFAULT_LAB, type EqBand } from "@/lib/dsp/lab-settings";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

function makeBands(): EqBand[] {
  return DEFAULT_LAB.rack.eq.bands.map((b) => ({ ...b }));
}

describe("EqCurveOverlay", () => {
  it("renders touch-none handles and 0/±6/±12 dB gridlines", () => {
    const bands = makeBands();
    const { container } = render(
      <EqCurveOverlay bands={bands} onChangeBand={() => {}} />
    );

    const handles = screen.getAllByRole("slider");
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect(handle.className).toContain("touch-none");
    }

    const lines = container.querySelectorAll("svg line");
    expect(lines).toHaveLength(5);
  });

  it("adjusts Q on wheel over a handle", () => {
    const bands = makeBands();
    const onChangeBand = mock();
    render(<EqCurveOverlay bands={bands} onChangeBand={onChangeBand} />);

    const handle = screen.getByRole("slider", { name: "EQ band 2" });
    fireEvent.wheel(handle, { deltaY: -120 });

    expect(onChangeBand).toHaveBeenCalledTimes(1);
    const [index, patch] = onChangeBand.mock.calls[0]!;
    expect(index).toBe(1);
    expect(patch.q).toBeGreaterThan(bands[1]!.q);
  });

  it("resets a band on handle double-click without bubbling to overlay", () => {
    const bands = makeBands();
    bands[1] = { ...bands[1]!, gainDb: 6.5, q: 3.2 };
    const onChangeBand = mock();
    render(<EqCurveOverlay bands={bands} onChangeBand={onChangeBand} />);

    const handle = screen.getByRole("slider", { name: "EQ band 2" });
    fireEvent.doubleClick(handle);

    expect(onChangeBand).toHaveBeenCalledTimes(1);
    expect(onChangeBand).toHaveBeenCalledWith(1, {
      gainDb: 0,
      q: DEFAULT_LAB.rack.eq.bands[1]!.q,
    });
  });

  it("adds a peaking band on overlay double-click when a slot is free", () => {
    const bands = makeBands();
    const onChangeBand = mock();
    const { container } = render(
      <EqCurveOverlay bands={bands} onChangeBand={onChangeBand} />
    );

    const overlay = container.firstElementChild as HTMLElement;
    overlay.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 112,
        right: 400,
        bottom: 112,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.doubleClick(overlay, { clientX: 200, clientY: 28 });

    expect(onChangeBand).toHaveBeenCalledTimes(1);
    const [index, patch] = onChangeBand.mock.calls[0]!;
    expect(index).toBe(0);
    expect(patch.kind).toBe("peaking");
    expect(patch.gainDb).toBeCloseTo(9, 1);
  });
});
