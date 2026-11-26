import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrackRow } from "@workspace/session-diff";
import { SetSkyline } from "./set-skyline";

const row = (name: string, over: Partial<TrackRow> = {}): TrackRow => ({
  key: name,
  kind: "audio",
  name,
  status: "same",
  devices: [],
  ...over,
});

const render = (...rows: TrackRow[]) =>
  renderToStaticMarkup(<SetSkyline structure={{ rows, truncated: false }} />);

describe("SetSkyline", () => {
  it("draws a bar per track, carrying its place in the set and the DAW's colour", () => {
    const html = render(
      row("Kick", { color: "#ff3636" }),
      row("Snare", { color: "#5480e4" })
    );

    expect(html.match(/data-diff-bar=/g)).toHaveLength(2);
    expect(html).toContain('data-diff-bar="0"');
    expect(html).toContain("--track:#ff3636");
    expect(html).toContain('data-diff-bar="1"');
    expect(html).toContain("--track:#5480e4");
  });

  it("says in words what the drawing shows", () => {
    const html = render(
      row("Kick"),
      row("Keys", { status: "added" }),
      row("Gtr", { status: "removed" }),
      row("Bass", { status: "changed" })
    );

    expect(html).toContain(
      'aria-label="The set&#x27;s 4 tracks: 1 added, 1 removed, 1 changed."'
    );
  });

  it("marks each change under its bar, and draws a removed track as a ghost", () => {
    const html = render(
      row("Keys", { status: "added" }),
      row("Gtr", { status: "removed" }),
      row("Bass", { status: "renamed" })
    );

    expect(html).toContain('data-mark="added"');
    expect(html).toContain('data-mark="removed"');
    expect(html).toContain('data-mark="changed"');
    expect(html).toContain("border-dashed");
    expect(html).toContain("clip-path:polygon(50%_0,100%_100%,0_100%)");
  });

  it("names a top-level group under the bars it holds once it spans enough of the set", () => {
    const members = Array.from({ length: 29 }, (_, i) =>
      row(`Hit ${i}`, { id: 10 + i, groupId: 1 })
    );
    const html = render(
      row("DRUMS", { kind: "group", id: 1, color: "#ff94a6" }),
      ...members,
      row("Lone", { kind: "group", id: 2 }),
      row("Inside", { id: 3, groupId: 2 })
    );

    expect(html).toContain('title="DRUMS"');
    expect(html).toMatch(/truncate pr-2 text-ink-soft[^>]*>DRUMS</);
    // Two tracks of thirty-two is too narrow to name.
    expect(html).not.toMatch(/text-ink-soft[^>]*>Lone</);
  });

  it("names a group that spans little of the set only on a wide skyline", () => {
    const hits = (groupId: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        row(`Hit ${groupId}.${i}`, { id: groupId * 100 + i, groupId })
      );
    // BASS spans a tenth of the set; DRUMS the rest.
    const html = render(
      row("BASS", { kind: "group", id: 1 }),
      ...hits(1, 9),
      row("DRUMS", { kind: "group", id: 2 }),
      ...hits(2, 89)
    );

    expect(html).toMatch(/@max-xl\/skyline:hidden"[^>]*>BASS</);
    expect(html).toMatch(/pr-2 text-ink-soft"[^>]*>DRUMS</);
  });

  it("sets the returns apart after a column of air", () => {
    const html = render(
      row("Kick"),
      row("Snare"),
      row("A Reverb", { kind: "return" })
    );

    expect(html).toContain("grid-template-columns:repeat(4, minmax(0, 1fr))");
    expect(html).toMatch(/data-diff-bar="2"[^>]*grid-column:4/);
  });
});
