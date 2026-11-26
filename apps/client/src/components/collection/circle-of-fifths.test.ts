import { describe, expect, it } from "bun:test";
import {
  beatSeconds,
  DEFAULT_CIRCLE_LAYOUT,
  keyDots,
  keyLabels,
  pointOnCircle,
} from "./circle-of-fifths";

describe("keyLabels", () => {
  it("places twelve labels around the ring", () => {
    expect(keyLabels("sharps")).toHaveLength(12);
  });

  it("labels the spokes in the notation it is given", () => {
    const at = (notation: Parameters<typeof keyLabels>[0]) =>
      keyLabels(notation).map((spoke) => spoke.label);
    expect(at("sharps").slice(6, 8)).toEqual(["F♯", "C♯"]);
    expect(at("flats").slice(6, 8)).toEqual(["G♭", "D♭"]);
    expect(at("camelot").slice(0, 2)).toEqual(["8B", "9B"]);
    expect(at("openkey").slice(0, 2)).toEqual(["1d", "2d"]);
  });

  it("puts C at twelve o'clock, straight above the centre", () => {
    const [c] = keyLabels("sharps");
    expect(c!.label).toBe("C");
    expect(c!.x).toBeCloseTo(DEFAULT_CIRCLE_LAYOUT.cx, 5);
    expect(c!.y).toBeCloseTo(
      DEFAULT_CIRCLE_LAYOUT.cy - DEFAULT_CIRCLE_LAYOUT.labelR,
      5
    );
  });
});

describe("keyDots", () => {
  it("places one dot per track with a recognised key", () => {
    const dots = keyDots([
      { id: 1, title: "Track A", key: "C major" },
      { id: 2, title: "Track B", key: "A minor" },
    ]);
    expect(dots).toHaveLength(2);
  });

  it("puts a major key on the outer ring and its relative minor on the inner one, at the same spoke", () => {
    const dots = keyDots([
      { id: 1, title: "C major track", key: "C major" },
      { id: 2, title: "A minor track", key: "A minor" },
    ]);
    const [major, minor] = dots;
    expect(major!.ring).toBe("outer");
    expect(minor!.ring).toBe("inner");
    // Both sit on C's spoke — straight up from the centre.
    expect(major!.x).toBeCloseTo(minor!.x, 5);
  });

  it("places a track keyed from its session, which spells the key its own way", () => {
    const dots = keyDots([
      { id: 1, title: "Scanned", key: "C Major" },
      { id: 2, title: "Scanned sharp", key: "C# Major" },
    ]);
    const [c, cSharp] = dots;
    expect(c).toMatchObject({ ring: "outer", trackId: 1 });
    expect(c!.x).toBeCloseTo(DEFAULT_CIRCLE_LAYOUT.cx, 5);
    expect(c!.y).toBeCloseTo(
      DEFAULT_CIRCLE_LAYOUT.cy - DEFAULT_CIRCLE_LAYOUT.outerR,
      5
    );
    // C♯ major is seven fifths round from C.
    expect(cSharp).toMatchObject(
      pointOnCircle(7, DEFAULT_CIRCLE_LAYOUT.outerR)
    );
  });

  it("names the track a hover would read", () => {
    const [dot] = keyDots([{ id: 7, title: "Interlude", key: "G major" }]);
    expect(dot).toMatchObject({ trackId: 7, title: "Interlude" });
  });

  it("drops a track with no recognisable key rather than crashing", () => {
    expect(keyDots([{ id: 1, title: "No key", key: "" }])).toEqual([]);
  });

  it("spreads two tracks sharing a key apart, so neither hides the other's hover target", () => {
    const dots = keyDots([
      { id: 1, title: "Track A", key: "C major" },
      { id: 2, title: "Track B", key: "C major" },
    ]);
    const [a, b] = dots;
    expect(a!.x !== b!.x || a!.y !== b!.y).toBe(true);
  });

  it("keeps a crowded key's dots nearer their own spoke than a neighbouring one", () => {
    const tracks = Array.from({ length: 5 }, (_, i) => ({
      id: i,
      title: `Track ${i}`,
      key: "A minor",
    }));
    const dots = keyDots(tracks);
    const { innerR } = DEFAULT_CIRCLE_LAYOUT;
    // A minor is the relative minor of C, so it sits on spoke 0.
    const own = pointOnCircle(0, innerR);
    const neighbours = [pointOnCircle(1, innerR), pointOnCircle(11, innerR)];
    const distance = (
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => Math.hypot(a.x - b.x, a.y - b.y);

    for (const dot of dots) {
      for (const neighbour of neighbours) {
        expect(distance(dot, own)).toBeLessThan(distance(dot, neighbour));
      }
    }
  });

  it("keeps every dot inside the drawing however many tracks share a key", () => {
    const tracks = Array.from({ length: 32 }, (_, i) => ({
      id: i,
      title: `Track ${i}`,
      key: "C major",
    }));

    for (const dot of keyDots(tracks)) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(100);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(100);
    }
  });

  it("keeps a lone track's dot exactly on its spoke rather than always offsetting it", () => {
    const [dot] = keyDots([{ id: 1, title: "Track A", key: "C major" }]);
    const [c] = keyLabels("sharps");
    // C's spoke runs straight up from the centre; a single dot on it takes
    // no tangential offset, since there is nothing to spread it away from.
    expect(dot!.x).toBeCloseTo(c!.x, 5);
  });
});

describe("pointOnCircle", () => {
  it("lands a quarter turn (spoke 3 of 12) to the right of the centre", () => {
    const point = pointOnCircle(3, 10, {
      cx: 0,
      cy: 0,
      outerR: 0,
      innerR: 0,
      labelR: 0,
    });
    expect(point.x).toBeCloseTo(10, 5);
    expect(point.y).toBeCloseTo(0, 5);
  });
});

describe("beatSeconds", () => {
  it("is one beat at the track's tempo", () => {
    expect(beatSeconds(120)).toBeCloseTo(0.5);
    expect(beatSeconds(90)).toBeCloseTo(60 / 90);
  });

  it("holds a tempo outside a playable range to its edge", () => {
    expect(beatSeconds(400)).toBeCloseTo(60 / 220);
    expect(beatSeconds(10)).toBeCloseTo(60 / 40);
    expect(beatSeconds(Number.NaN)).toBeCloseTo(0.5);
  });
});
