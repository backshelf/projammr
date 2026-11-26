import { describe, expect, it } from "bun:test";
import { loudnessRuler } from "@workspace/ui/components/loudness/loudness-scale";
import {
  DEFAULT_FORMAT_PREFS,
  defaultFormatters,
  formattersFor,
} from "@workspace/ui/lib/formatters";
import { tempoRuler } from "@workspace/session-diff/ruler";
import { markTitle, positionOf } from "./ruler-scale";

/** The loudness ruler at the streaming reference the app marks by default. */
const LOUDNESS_RULER = loudnessRuler(-14);

describe("positionOf", () => {
  it("places a value proportionally between the ruler's ends", () => {
    expect(positionOf(-14, -28, 0)).toBe(50);
    expect(positionOf(-28, -28, 0)).toBe(0);
    expect(positionOf(0, -28, 0)).toBe(100);
  });

  it("clamps a value past either end onto the ruler", () => {
    expect(positionOf(-40, -28, 0)).toBe(0);
    expect(positionOf(10, -28, 0)).toBe(100);
  });
});

describe("markTitle", () => {
  it("rounds a mark's own reading to loudness's one decimal, unlike a stop's whole numeral", () => {
    // A stop's `format` truncates to a whole number ("−16"); a measured
    // mark keeps the one decimal `formatLufs` always showed.
    expect(markTitle(LOUDNESS_RULER, { value: -16.34, label: "v2" })).toBe(
      "v2 · −16.3 LUFS"
    );
  });

  it("still adds the decimal to a mark landing on a whole number", () => {
    expect(markTitle(LOUDNESS_RULER, { value: -8, label: "v3" })).toBe(
      "v3 · −8.0 LUFS"
    );
  });

  it("omits the unit when the config carries none", () => {
    const config = { ...LOUDNESS_RULER, unit: undefined };
    expect(markTitle(config, { value: -16, label: "v2" })).toBe("v2 · −16.0");
  });
});

describe("the loudness preset", () => {
  it("reproduces LoudnessScale's own ruler stops and reference", () => {
    expect(LOUDNESS_RULER.min).toBe(-28);
    expect(LOUDNESS_RULER.max).toBe(0);
    expect(LOUDNESS_RULER.stops).toEqual([-28, -21, -14, -7, 0]);
    expect(LOUDNESS_RULER.reference).toBe(-14);
  });

  it("positions every stop exactly where LoudnessScale always drew it", () => {
    // The 28-LUFS-wide scale used to divide these five stops evenly.
    expect(
      LOUDNESS_RULER.stops.map((lufs) =>
        positionOf(lufs, LOUDNESS_RULER.min, LOUDNESS_RULER.max)
      )
    ).toEqual([0, 25, 50, 75, 100]);
  });

  it("formats each stop the way LoudnessScale's numeral() always did", () => {
    expect(
      LOUDNESS_RULER.stops.map((lufs) => LOUDNESS_RULER.format(lufs))
    ).toEqual(["−28", "−21", "−14", "−7", "0"]);
  });

  it("moves only its reference line and that line's title with the reference", () => {
    const apple = loudnessRuler(-16);

    expect(apple.reference).toBe(-16);
    expect(apple.referenceTitle).toBe("Loudness reference: −16 LUFS");
    expect(apple.stops).toEqual(LOUDNESS_RULER.stops);
  });
});

describe("the tempo preset", () => {
  const ruler = tempoRuler(defaultFormatters("UTC"));

  it("runs 60 to 200 BPM", () => {
    expect(ruler.min).toBe(60);
    expect(ruler.max).toBe(200);
  });

  it("positions a tempo and titles a mark on its own domain", () => {
    expect(positionOf(130, ruler.min, ruler.max)).toBe(50);
    expect(markTitle(ruler, { value: 128, label: "Intro" })).toBe(
      "Intro · 128 BPM"
    );
  });

  it("writes whole stops, and a detected tempo whole by default", () => {
    expect(ruler.stops.map(ruler.format)).toEqual(["60", "100", "140", "180"]);
    expect(markTitle(ruler, { value: 127.8, label: "Intro" })).toBe(
      "Intro · 128 BPM"
    );
  });

  it("writes a mark as the viewer's tempo preference says, never twice the unit", () => {
    const tenths = tempoRuler(
      formattersFor(
        {
          ...DEFAULT_FORMAT_PREFS,
          tempo: { rounding: "one-decimal", suffix: true },
        },
        "UTC"
      )
    );
    expect(markTitle(tenths, { value: 127.84, label: "Intro" })).toBe(
      "Intro · 127.8 BPM"
    );
    expect(tenths.format(100)).toBe("100");
  });
});
