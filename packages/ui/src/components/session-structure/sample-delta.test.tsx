import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SampleDelta } from "./sample-delta";

describe("SampleDelta", () => {
  it("names each sample by its file, keeping the full path as its title", () => {
    const html = renderToStaticMarkup(
      <SampleDelta
        samples={{
          added: ["/Users/sam/Samples/Kick 01.wav"],
          removed: ["C:\\Samples\\Snare.aif"],
        }}
      />
    );
    expect(html).toContain("SAMPLES");
    expect(html).toContain(
      'class="text-art" title="/Users/sam/Samples/Kick 01.wav">+ Kick 01.wav'
    );
    expect(html).toContain(
      'class="text-ink-faint line-through" title="C:\\Samples\\Snare.aif">− Snare.aif'
    );
  });

  it("renders nothing when no sample came or went", () => {
    expect(
      renderToStaticMarkup(<SampleDelta samples={{ added: [], removed: [] }} />)
    ).toBe("");
  });
});
