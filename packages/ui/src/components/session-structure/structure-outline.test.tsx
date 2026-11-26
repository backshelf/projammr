import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructureDiff, TrackRow } from "@workspace/session-diff";
import { StructureOutline } from "./structure-outline";

function row(
  overrides: Partial<TrackRow> & { kind: TrackRow["kind"] }
): TrackRow {
  return {
    key: overrides.name ?? overrides.kind,
    name: overrides.kind,
    status: "same",
    devices: [],
    ...overrides,
  };
}

function diffOf(...rows: TrackRow[]): StructureDiff {
  return { rows, truncated: false };
}

describe("StructureOutline", () => {
  it("gives a master track its own glyph rather than falling back to a generic one", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(row({ kind: "master", name: "Master" }))}
      />
    );
    expect(html).toContain("Master track");
    expect(html).toContain("Master");
  });

  it("gives a track of an unrecognised kind the other glyph and its own name", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(row({ kind: "other", name: "Weird Bus" }))}
      />
    );
    expect(html).toContain("Other track");
    expect(html).toContain("Weird Bus");
  });

  it("shows a return track under its own name rather than a lettered position", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(row({ kind: "return", name: "Reverb Return" }))}
      />
    );
    expect(html).toContain("Return track");
    expect(html).toContain("Reverb Return");
    expect(html).not.toContain(">A<");
  });

  it("draws a diff on the row shape: additions in art, removals struck, renames beside their old name", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({
            kind: "audio",
            name: "Vox",
            status: "changed",
            devices: [
              { name: "EQ Eight", status: "same", origin: "builtin" },
              { name: "Pro-Q 4", status: "added", origin: "plugin" },
            ],
          }),
          row({ kind: "midi", name: "Keys", status: "added" }),
          row({ kind: "audio", name: "Gtr", status: "removed" }),
          row({
            kind: "audio",
            name: "Bass DI",
            was: "Bass",
            status: "renamed",
          })
        )}
      />
    );
    expect(html).toMatch(/text-art[^"]*">\+Pro-Q 4</);
    expect(html).toMatch(/text-ink-soft[^"]*">EQ Eight</);
    expect(html).toMatch(/text-art[^"]*">Keys</);
    expect(html).toMatch(/text-ink-faint line-through[^"]*">Gtr</);
    expect(html).toMatch(/line-through">Bass</);
  });

  it("marks each changed row in the gutter in words a screen reader hears too", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({ kind: "audio", name: "Kick" }),
          row({ kind: "midi", name: "Keys", status: "added" }),
          row({ kind: "audio", name: "Gtr", status: "removed" })
        )}
      />
    );
    expect(html).toContain('<span aria-hidden="true">+</span>');
    expect(html).toContain('<span class="sr-only">Added</span>');
    expect(html).toContain('<span aria-hidden="true">−</span>');
    expect(html).toContain('<span class="sr-only">Removed</span>');
  });

  it("keeps no gutter when nothing is marked, as for a set's first save", () => {
    const html = renderToStaticMarkup(
      <StructureOutline diff={diffOf(row({ kind: "audio", name: "Kick" }))} />
    );
    expect(html).not.toContain("font-sub text-small");
  });

  it("leads each row with the DAW's colour for it, and an empty ring where it has none", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        colors
        diff={diffOf(
          row({ kind: "audio", name: "Kick", color: "#ff3636" }),
          row({ kind: "audio", name: "Snare" })
        )}
      />
    );
    const swatches = html.match(/data-slot="track-swatch"/g) ?? [];
    expect(swatches).toHaveLength(2);
    expect(html).toContain('style="--track:#ff3636"');
  });

  it("draws no swatches for a DAW that reports no colours", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(row({ kind: "audio", name: "Kick", color: "#ff3636" }))}
      />
    );
    expect(html).not.toContain("track-swatch");
  });

  it("names the format a plugin is hosted in beside it", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({
            kind: "midi",
            name: "Lead",
            devices: [
              { name: "Surge", status: "same", origin: "plugin", host: "clap" },
            ],
          })
        )}
      />
    );
    expect(html).toMatch(
      />Surge<\/span><span class="[^"]*text-ink-faint">clap</
    );
  });

  it("carries each row's place in the set and what the save did to it", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({ kind: "audio", name: "Kick" }),
          row({ kind: "midi", name: "Keys", status: "added" })
        )}
      />
    );
    expect(html).toContain('data-diff-row="0"');
    expect(html).toMatch(/data-diff-row="1" data-change="added"/);
    expect(html).not.toMatch(/data-diff-row="0" data-change/);
  });

  it("lets a client hide what did not change, but never a group holding a change", () => {
    const hides = "group-data-[mode=changes]/save-diff:hidden";
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({ kind: "group", name: "Drums", id: 1 }),
          row({ kind: "audio", name: "Kick", id: 2, groupId: 1 }),
          row({
            kind: "audio",
            name: "Snare",
            id: 3,
            groupId: 1,
            status: "added",
          }),
          row({ kind: "audio", name: "Lead", id: 4 })
        )}
      />
    );
    // Kick and Lead hide; the Drums group and its new Snare stay.
    expect(html.split(hides)).toHaveLength(3);
    expect(html.split('data-unchanged=""')).toHaveLength(3);
    expect(html).toMatch(/<details class="group\/disclosure" open="">/);
  });

  it("nests a group's tracks under a native disclosure carrying its count", () => {
    const html = renderToStaticMarkup(
      <StructureOutline
        diff={diffOf(
          row({ kind: "group", name: "Drums", id: 1 }),
          row({ kind: "audio", name: "Kick", id: 2, groupId: 1 }),
          row({ kind: "audio", name: "Snare", id: 3, groupId: 1 })
        )}
      />
    );
    expect(html).toContain("group/disclosure");
    expect(html).toContain("2 tracks");
  });
});
