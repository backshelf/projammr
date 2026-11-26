import { Meter, MeterCell } from "@workspace/ui/components/table";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("Meter", () => {
  it("prints no figure by default", () => {
    render(<Meter value={42} aria-label={"job progress"} />);

    expect(screen.queryByText("42%")).toBeNull();
  });

  it("prints the rounded percentage when showValue is set", () => {
    render(<Meter value={41.6} showValue aria-label={"job progress"} />);

    expect(screen.getByText("42%")).not.toBeNull();
  });
});

describe("MeterCell", () => {
  it("shows the figure by default, one primitive owning the readout", () => {
    render(<MeterCell value={75} />);

    expect(screen.getByText("75%")).not.toBeNull();
  });

  it("hides the figure when told to", () => {
    render(<MeterCell value={75} showValue={false} />);

    expect(screen.queryByText("75%")).toBeNull();
  });
});
