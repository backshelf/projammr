import { describe, expect, test } from "bun:test";
import {
  bandFraction,
  dragToBand,
  EQ_GAIN_WINDOW,
  gainAtFraction,
  hzAtFraction,
  nearestBand,
  qDragStep,
  Q_MAX,
  Q_MIN,
  stepGain,
  stepHz,
  stepQFromDrag,
} from "./eq-curve-geometry";

describe("hzAtFraction / gainAtFraction", () => {
  test("the low edge is 20 Hz and the high edge is 20 kHz", () => {
    expect(hzAtFraction(0)).toBe(20);
    expect(hzAtFraction(1)).toBe(20000);
  });

  test("the midpoint is the geometric mean, since the axis is log", () => {
    expect(hzAtFraction(0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 5);
  });

  test("the top of the drawing is the window's ceiling and the bottom its floor", () => {
    expect(gainAtFraction(0)).toBe(EQ_GAIN_WINDOW[1]);
    expect(gainAtFraction(1)).toBe(EQ_GAIN_WINDOW[0]);
  });

  test("clamps a fraction outside 0..1", () => {
    expect(hzAtFraction(-1)).toBe(20);
    expect(hzAtFraction(2)).toBe(20000);
    expect(gainAtFraction(-1)).toBe(EQ_GAIN_WINDOW[1]);
    expect(gainAtFraction(2)).toBe(EQ_GAIN_WINDOW[0]);
  });
});

describe("bandFraction / dragToBand", () => {
  test("round-trips a band's own position back to its frequency and gain", () => {
    const band = { hz: 1000, gainDb: 6 };
    const pos = bandFraction(band);
    const back = dragToBand(pos.x, pos.y);
    expect(back.hz).toBeCloseTo(band.hz, 0);
    expect(back.gainDb).toBeCloseTo(band.gainDb, 5);
  });
});

describe("nearestBand", () => {
  const bands = [
    { hz: 100, gainDb: 0 },
    { hz: 1000, gainDb: 6 },
    { hz: 10000, gainDb: -6 },
  ];

  test("finds the handle a pointer landed on", () => {
    const pos = bandFraction(bands[1]!);
    expect(nearestBand(bands, pos.x, pos.y)).toBe(1);
  });

  test("claims nothing far from every handle", () => {
    expect(nearestBand(bands, 0.5, 0.5)).toBeNull();
  });

  test("picks the closest of two handles within reach", () => {
    const close = [
      { hz: 950, gainDb: 0 },
      { hz: 1050, gainDb: 0 },
    ];
    const a = bandFraction(close[0]!);
    const b = bandFraction(close[1]!);
    const between = { x: (a.x + b.x) / 2 - 0.002, y: (a.y + b.y) / 2 };
    expect(nearestBand(close, between.x, between.y)).toBe(0);
  });
});

describe("stepGain", () => {
  test("moves by a whole decibel by default", () => {
    expect(stepGain(0, 1, false)).toBe(1);
    expect(stepGain(0, -1, false)).toBe(-1);
  });

  test("moves by a tenth held fine", () => {
    expect(stepGain(0, 1, true)).toBeCloseTo(0.1, 5);
  });

  test("clamps to the window", () => {
    expect(stepGain(EQ_GAIN_WINDOW[1], 1, false)).toBe(EQ_GAIN_WINDOW[1]);
    expect(stepGain(EQ_GAIN_WINDOW[0], -1, false)).toBe(EQ_GAIN_WINDOW[0]);
  });
});

describe("stepHz", () => {
  test("moves proportionally rather than by a fixed amount", () => {
    const up = stepHz(1000, 1, false);
    const upFromHigher = stepHz(10000, 1, false);
    expect(up).toBeGreaterThan(1000);
    expect(upFromHigher - 10000).toBeGreaterThan(up - 1000);
  });

  test("a smaller step held fine", () => {
    expect(stepHz(1000, 1, true) - 1000).toBeLessThan(
      stepHz(1000, 1, false) - 1000
    );
  });

  test("clamps to 20..20000", () => {
    expect(stepHz(20, -1, false)).toBe(20);
    expect(stepHz(20000, 1, false)).toBe(20000);
  });
});

describe("stepQFromDrag", () => {
  test("dragging up (negative delta) raises Q", () => {
    expect(stepQFromDrag(1, -0.1)).toBeGreaterThan(1);
  });

  test("dragging down lowers Q", () => {
    expect(stepQFromDrag(1, 0.1)).toBeLessThan(1);
  });

  test("clamps to the domain", () => {
    expect(stepQFromDrag(Q_MAX, -1)).toBe(Q_MAX);
    expect(stepQFromDrag(Q_MIN, 1)).toBe(Q_MIN);
  });
});

describe("qDragStep", () => {
  test("the first move anchors the drag and reports the starting Q unchanged", () => {
    const { origin, q } = qDragStep(null, 0.7, 0.5);
    expect(origin).toEqual({ q: 0.7, y: 0.5 });
    expect(q).toBe(0.7);
  });

  test("measures every later move against the same anchor, not the last result", () => {
    const first = qDragStep(null, 0.7, 0.5);
    const second = qDragStep(first.origin, 999, 0.4);
    const third = qDragStep(second.origin, 999, 0.3);

    // Both later moves carry the same origin forward untouched.
    expect(second.origin).toEqual(first.origin);
    expect(third.origin).toEqual(first.origin);
    // A move back to the first move's `y` returns exactly its Q, which a
    // formula compounding onto the previous move's output could not do.
    expect(qDragStep(third.origin, 999, 0.5).q).toBe(0.7);
    expect(third.q).toBe(stepQFromDrag(0.7, 0.3 - 0.5));
  });

  test("repeating the same pointer position does not keep multiplying Q", () => {
    const anchored = qDragStep(null, 0.7, 0.5);
    let origin = anchored.origin;
    let q = anchored.q;
    // Five more moves land at the same `y` — jitter with no net travel. A
    // formula reusing the previous move's Q as its own base would multiply
    // by `stepQFromDrag`'s factor five times over; the anchored version
    // reports the same value every time.
    for (let i = 0; i < 5; i++) {
      ({ origin, q } = qDragStep(origin, q, 0.4));
    }

    expect(q).toBeCloseTo(stepQFromDrag(0.7, -0.1), 10);
  });

  test("releasing and re-holding shift re-anchors from the current Q", () => {
    const held = qDragStep(null, 0.7, 0.5);
    const moved = qDragStep(held.origin, 0.7, 0.4);
    // Shift released: the caller drops the origin. Re-holding starts fresh
    // from wherever Q ended up, not from the original anchor.
    const reheld = qDragStep(null, moved.q, 0.4);

    expect(reheld.q).toBe(moved.q);
    expect(reheld.origin).toEqual({ q: moved.q, y: 0.4 });
  });
});
