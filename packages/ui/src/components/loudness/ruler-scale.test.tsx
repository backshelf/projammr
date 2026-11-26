import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { tempoRuler } from "@workspace/session-diff/ruler";
import { RulerScale } from "./ruler-scale";

const TEMPO_RULER = tempoRuler(defaultFormatters("UTC"));

describe("RulerScale", () => {
  it("points its caret straight at the value it names", () => {
    const html = renderToStaticMarkup(
      <RulerScale config={TEMPO_RULER} marks={[]} pointer={130} label="Tempo" />
    );

    expect(html).not.toContain("ruler-caret");
    expect(html).toMatch(/top-full[^"]*"[^>]*style="left:50%"/);
  });

  it("leaves a faint tick where a moved value was, and sends the caret from it", () => {
    const html = renderToStaticMarkup(
      <RulerScale
        config={TEMPO_RULER}
        marks={[]}
        pointer={130}
        was={116}
        label="Tempo"
      />
    );

    expect(html).toContain('title="Before · 116 BPM"');
    expect(html).toContain("bg-ink-faint");
    // 116 BPM sits 10 points of the ruler left of 130.
    expect(html).toContain('class="ruler-caret');
    expect(html).toContain("--caret-from:-10%");
  });
});
