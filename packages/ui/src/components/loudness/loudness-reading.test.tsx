import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LoudnessReading } from "./loudness-reading";
import { LoudnessUnit } from "./loudness-unit";

describe("LoudnessReading", () => {
  it("sets the figure in ink with its unit and qualifier beside it", () => {
    const html = renderToStaticMarkup(
      <LoudnessReading lufs={-9.24}>LUFS median</LoudnessReading>
    );
    expect(html).toMatch(/font-display-clean[^"]*text-ink">−9.2</);
    expect(html).toContain("LUFS median");
  });

  it("reads faint while the figure is still being measured", () => {
    const html = renderToStaticMarkup(
      <LoudnessReading lufs={-9.24} pending>
        LUFS
      </LoudnessReading>
    );
    expect(html).toMatch(/font-display-clean[^"]*text-ink-soft/);
  });
});

describe("LoudnessUnit", () => {
  it("renders the unit as a focusable abbreviation with no browser to ask", () => {
    const html = renderToStaticMarkup(<LoudnessUnit unit="LUFS" />);
    expect(html).toMatch(/<abbr[^>]*tabindex="0"[^>]*>LUFS<\/abbr>/);
  });

  it("keeps a compact unit out of the tab order", () => {
    const html = renderToStaticMarkup(<LoudnessUnit unit="M" compact />);
    expect(html).toMatch(/<abbr[^>]*>M<\/abbr>/);
    expect(html).not.toContain("tabindex");
  });
});
