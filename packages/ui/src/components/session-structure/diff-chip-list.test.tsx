import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DiffChipList } from "./diff-chip-list";

describe("DiffChipList", () => {
  it("colours an addition in art and strikes a removal through", () => {
    const html = renderToStaticMarkup(
      <DiffChipList
        chips={[
          { kind: "tracks", label: "+2 tracks", sign: "add" },
          { kind: "clips", label: "−3 clips", sign: "remove" },
        ]}
      />
    );
    expect(html).toMatch(/text-art font-medium[^>]*><svg[^>]*>.*?\+2 tracks/);
    expect(html).toMatch(
      /text-ink-faint line-through[^>]*><svg[^>]*>.*?−3 clips/
    );
  });

  it("lights the `to` half of a transition in ink", () => {
    const html = renderToStaticMarkup(
      <DiffChipList
        chips={[
          {
            kind: "tempo",
            label: "tempo 120 → 124",
            from: "120",
            to: "124",
          },
        ]}
      />
    );
    expect(html).toContain('tempo 120 → <span class="text-ink">124</span>');
  });

  it("drops the glyphs when compact", () => {
    const html = renderToStaticMarkup(
      <DiffChipList
        compact
        chips={[{ kind: "tracks", label: "+1 track", sign: "add" }]}
      />
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("+1 track");
  });

  it("renders nothing for a diff with no chips", () => {
    expect(renderToStaticMarkup(<DiffChipList chips={[]} />)).toBe("");
  });
});
