import { describe, expect, it } from "bun:test";
import {
  areaPath,
  curvePath,
  envelopePath,
  hzLabel,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  xOf,
  yOf,
} from "./spectrum-geometry";

const WINDOW: [number, number] = [-66, -18];
const HZ = [20, 200, 2000, 20000];
const DB = [-60, -30, -40, -50];

describe("xOf", () => {
  it("puts 20 Hz at the left edge and 20 kHz at the right", () => {
    expect(xOf(20)).toBe(0);
    expect(xOf(20000)).toBeCloseTo(VIEW_WIDTH, 6);
  });

  it("puts 1 kHz where a log axis does, past the middle", () => {
    expect(xOf(1000)).toBeCloseTo(566.3, 1);
  });
});

describe("yOf", () => {
  it("clamps above the ceiling and below the floor", () => {
    expect(yOf(-18, WINDOW)).toBe(0);
    expect(yOf(-66, WINDOW)).toBe(VIEW_HEIGHT);
    expect(yOf(0, WINDOW)).toBe(0);
    expect(yOf(-120, WINDOW)).toBe(VIEW_HEIGHT);
  });
});

describe("curvePath", () => {
  it("moves to the first band and draws one segment per band after it", () => {
    const d = curvePath(HZ, DB, WINDOW);

    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/L/g)).toHaveLength(HZ.length - 1);
  });

  it("is empty with no bands", () => {
    expect(curvePath([], [], WINDOW)).toBe("");
  });
});

describe("areaPath", () => {
  it("closes the curve down to the floor at both ends", () => {
    const d = areaPath(HZ, DB, WINDOW);

    expect(d.startsWith(curvePath(HZ, DB, WINDOW))).toBe(true);
    expect(d).toEndWith(
      `L${xOf(20000).toFixed(1)} ${VIEW_HEIGHT}L${xOf(20).toFixed(1)} ${VIEW_HEIGHT}Z`
    );
  });

  it("is empty with no bands", () => {
    expect(areaPath([], [], WINDOW)).toBe("");
  });
});

describe("envelopePath", () => {
  it("visits every band twice and closes", () => {
    const min = [-70, -40, -50, -60];
    const max = DB;

    const d = envelopePath(HZ, min, max, WINDOW);

    expect(d.match(/L/g)).toHaveLength(HZ.length * 2 - 1);
    expect(d).toEndWith("Z");
    expect(d).toContain(`${xOf(20).toFixed(1)} ${yOf(-70, WINDOW).toFixed(1)}`);
  });

  it("is empty with no bands", () => {
    expect(envelopePath([], [], [], WINDOW)).toBe("");
  });
});

describe("hzLabel", () => {
  it("writes kilohertz in thousands and the rest plainly", () => {
    expect(hzLabel(2000)).toBe("2k");
    expect(hzLabel(20000)).toBe("20k");
    expect(hzLabel(200)).toBe("200");
  });
});
