import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LoudnessScale } from "./loudness-scale";
import { RulerScale } from "./ruler-scale";

/** The streaming reference the app's meters mark by default. */
const STREAMING = -14;

describe("LoudnessScale", () => {
  it("names the drawing for a screen reader and numbers the ruler's five stops", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale
        marks={[]}
        reference={STREAMING}
        label="Loudness of 3 versions"
      />
    );
    expect(html).toContain('role="img" aria-label="Loudness of 3 versions"');
    for (const stop of ["−28", "−21", "−14", "−7", ">0<"]) {
      expect(html).toContain(stop);
    }
  });

  it("marks the streaming reference with a dotted hairline at the centre", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale marks={[]} reference={STREAMING} label="Loudness" />
    );
    expect(html).toContain(
      'title="Loudness reference: −14 LUFS" class="absolute inset-y-0 w-px'
    );
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain("left:50%");
  });

  it("draws the hairline wherever the reference it is given sits", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale marks={[]} reference={-7} label="Loudness" />
    );
    expect(html).toContain(
      'title="Loudness reference: −7 LUFS" class="absolute inset-y-0 w-px'
    );
    expect(html).toContain("left:75%");
  });

  it("draws one art tick per measurement, titled with its label and reading", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale
        marks={[
          { lufs: -9.24, label: "v2" },
          { lufs: -14, label: "v1" },
        ]}
        reference={STREAMING}
        label="Loudness"
      />
    );
    expect(html).toContain('title="v2 · −9.2 LUFS"');
    expect(html).toContain('title="v1 · −14.0 LUFS"');
    expect(html.match(/bg-art"/g)?.length).toBe(2);
  });

  it("points the caret at the value the block names, under the baseline", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale
        marks={[]}
        reference={STREAMING}
        pointer={-7}
        label="Loudness"
      />
    );
    expect(html).toMatch(/top-full[^"]*bg-ink[^"]*" style="left:75%"/);
  });

  it("sets its numerals on art when it sits over an artwork field", () => {
    const html = renderToStaticMarkup(
      <LoudnessScale
        marks={[]}
        reference={STREAMING}
        tone="art"
        label="Loudness"
      />
    );
    expect(html).toContain("on-art-soft");
  });
});

describe("RulerScale", () => {
  it("lays a band across the spread of a domain it is given", () => {
    const html = renderToStaticMarkup(
      <RulerScale
        config={{
          min: 60,
          max: 200,
          stops: [60, 130, 200],
          format: String,
          unit: "BPM",
        }}
        marks={[{ value: 128, label: "Intro" }]}
        band={[95, 165]}
        label="Tempo"
      />
    );
    expect(html).toContain('title="Intro · 128 BPM"');
    expect(html).toContain("bg-art/30");
    expect(html).toContain("left:25%;width:calc(75% - 25%)");
  });
});
