import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { tempoRuler } from "@workspace/session-diff/ruler";
import { DiffReadouts } from "./diff-readouts";

const TEMPO_RULER = tempoRuler(defaultFormatters("UTC"));

describe("DiffReadouts", () => {
  it("sets a moved tempo on its ruler, the caret travelling from the old figure", () => {
    const html = renderToStaticMarkup(
      <DiffReadouts
        readouts={[
          {
            gauge: "ruler",
            label: "Tempo",
            ruler: TEMPO_RULER,
            from: 124,
            to: 128,
          },
        ]}
      />
    );

    expect(html).toContain("Tempo");
    expect(html).toMatch(/>124<.*→.*>128<.*BPM/);
    expect(html).toContain('aria-label="Tempo moved from 124 to 128 BPM"');
    expect(html).toContain('title="Before · 124 BPM"');
    expect(html).toContain("ruler-caret");
    // 124 BPM sits 4/140 of the ruler left of 128.
    expect(html).toMatch(/--caret-from:-2\.857\d*%/);
  });

  it("reads counts with their separators and the change signed", () => {
    const html = renderToStaticMarkup(
      <DiffReadouts
        readouts={[
          {
            gauge: "meters",
            label: "Clips",
            meters: [
              { label: "Audio", from: 2436, to: 2452 },
              { label: "MIDI", from: 20, to: 8 },
            ],
          },
        ]}
      />
    );

    expect(html).toContain("2,436");
    expect(html).toContain("2,452");
    expect(html).toMatch(/text-art">\+<!-- -->16|text-art">\+16/);
    expect(html).toMatch(/text-ink-faint">−<!-- -->12|text-ink-faint">−12/);
    expect(html).toContain('aria-label="Audio 2436 to 2452"');
  });

  it("draws what each count kept at its own share of the one scale", () => {
    const html = renderToStaticMarkup(
      <DiffReadouts
        readouts={[
          {
            gauge: "meters",
            label: "Clips",
            meters: [
              { label: "Audio", from: 2436, to: 2452 },
              { label: "MIDI", from: 418, to: 421 },
            ],
          },
        ]}
      />
    );

    // 2436 and 418 of 2452, with nothing growing to split the rest.
    expect(html).toMatch(/flex:0 1 99\.34\d*%/);
    expect(html).toMatch(/flex:0 1 17\.04\d*%/);
    expect(html).not.toContain("flex-1");
  });

  it("reads a value with no scale as from and to", () => {
    const html = renderToStaticMarkup(
      <DiffReadouts
        readouts={[
          { gauge: "transition", label: "Key", from: null, to: "F Minor" },
        ]}
      />
    );

    expect(html).toMatch(/>—<.*→.*>F Minor</);
  });

  it("renders nothing when nothing moved", () => {
    expect(renderToStaticMarkup(<DiffReadouts readouts={[]} />)).toBe("");
  });
});
