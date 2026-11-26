import type { SaveMeta, SessionTrack } from "@workspace/api/api";
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_FORMAT_PREFS,
  defaultFormatters,
  formattersFor,
} from "@workspace/ui/lib/formatters";
import { diffSave } from "@workspace/session-diff";
import { SaveDiffCard, savePairLabel } from "./save-diff-card";

const ZONE = "Etc/GMT-10";
const asOf = new Date("2026-06-20T12:00:00+10:00");
const format = defaultFormatters(ZONE);

const track = (name: string, devices: string[] = []): SessionTrack => ({
  kind: "audio",
  name,
  devices,
});

const meta = (over: Partial<SaveMeta> = {}): SaveMeta => ({
  tempo: "124",
  timeSignature: "4/4",
  rootNote: "F",
  scale: "Minor",
  tracksCount: null,
  scenesCount: null,
  dawVersion: null,
  samplePaths: null,
  structure: {
    tracks: [track("Kick", ["EQ Eight"]), track("Pad")],
    clips: { audio: 4, midi: 2 },
  },
  ...over,
});

const ABLETON = ["tempo", "structure", "clips", "samplePaths", "trackColors"];

describe("savePairLabel", () => {
  const stamp = (at: string) => ({ at });

  it("gives two saves on one day that day once and both times", () => {
    expect(
      savePairLabel(
        {
          before: stamp("2026-06-14T18:32:00+10:00"),
          after: stamp("2026-06-14T21:05:00+10:00"),
        },
        { asOf, format }
      )
    ).toBe("Sun 14 Jun · 18:32 → 21:05");
  });

  it("gives saves on two days a day each", () => {
    expect(
      savePairLabel(
        {
          before: stamp("2026-06-13T22:10:00+10:00"),
          after: stamp("2026-06-14T21:05:00+10:00"),
        },
        { asOf, format }
      )
    ).toBe("Sat 13 Jun 22:10 → Sun 14 Jun 21:05");
  });

  it("says a save with nothing before it is the first seen, and today is today", () => {
    expect(
      savePairLabel(
        { before: null, after: stamp("2026-06-20T09:15:00+10:00") },
        { asOf, format }
      )
    ).toBe("Today · 09:15 · first save seen");
  });

  it("writes the times on the viewer's clock", () => {
    const twelve = formattersFor(
      { ...DEFAULT_FORMAT_PREFS, clock: "12h" },
      ZONE
    );
    expect(
      savePairLabel(
        { before: null, after: stamp("2026-06-20T21:15:00+10:00") },
        { asOf, format: twelve }
      )
    ).toBe("Today · 9:15 pm · first save seen");
  });
});

describe("SaveDiffCard", () => {
  const saves = {
    before: { at: "2026-06-14T18:32:00+10:00", machine: "Studio iMac" },
    after: { at: "2026-06-14T21:05:00+10:00", machine: "Studio iMac" },
  };

  const render = (
    diff: ReturnType<typeof diffSave>,
    extra: Partial<Parameters<typeof SaveDiffCard>[0]> = {}
  ) =>
    renderToStaticMarkup(
      <SaveDiffCard
        diff={diff}
        saves={saves}
        asOf={asOf}
        timeZone={ZONE}
        {...extra}
      />
    );

  it("draws the set, the values that moved and the outline", () => {
    const html = render(
      diffSave(
        meta(),
        meta({
          tempo: "128",
          structure: {
            tracks: [track("Kick", ["EQ Eight", "Saturator"]), track("Pad")],
            clips: { audio: 6, midi: 2 },
          },
        }),
        ABLETON
      )
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("ruler-caret");
    expect(html).toContain("Clips");
    expect(html).toContain("2 tracks · 1 changed");
    expect(html).toContain("+Saturator");
  });

  it("names where the newer save was made under when", () => {
    const html = render(diffSave(meta(), meta(), ABLETON), {
      daw: "Ableton Live 12.3",
    });

    expect(html).toContain("Sun 14 Jun · 18:32 → 21:05");
    expect(html).toContain("Ableton Live 12.3 · Studio iMac");
  });

  it("says so when two saves read the same", () => {
    const html = render(diffSave(meta(), meta(), ABLETON));
    expect(html).toContain("Nothing recorded changed between these saves.");
  });

  it("draws a first save as the set, with nothing marked and no such note", () => {
    const html = render(diffSave(null, meta(), ABLETON), {
      saves: { before: null, after: saves.after },
    });

    expect(html).toContain("first save seen");
    expect(html).not.toContain("data-mark=");
    expect(html).not.toContain("Nothing recorded changed");
  });

  it("draws no skyline or outline for a DAW that does not list its tracks", () => {
    const html = render(diffSave(meta(), meta({ tempo: "130" }), ["tempo"]));

    expect(html).not.toContain('role="img" aria-label="The set');
    expect(html).not.toContain("data-diff-row");
    expect(html).toContain("ruler-caret");
  });

  it("is a figure captioned by what it is given, when it is a page's proof", () => {
    const html = renderToStaticMarkup(
      <SaveDiffCard
        as="figure"
        diff={diffSave(meta(), meta(), ABLETON)}
        saves={saves}
        asOf={asOf}
        timeZone={ZONE}
      >
        <figcaption>halogen long outro.als</figcaption>
      </SaveDiffCard>
    );

    expect(html).toMatch(/^<figure[^>]*><figcaption>halogen long outro.als/);
  });

  it("puts what it is handed in place of the save times, keeping where", () => {
    const html = render(diffSave(meta(), meta(), ABLETON), {
      daw: "Ableton Live 12.3",
      when: <span>From 14 Jun To 14 Jun</span>,
    });

    expect(html).toContain("<span>From 14 Jun To 14 Jun</span>");
    expect(html).not.toContain("18:32 → 21:05");
    expect(html).toContain("Ableton Live 12.3 · Studio iMac");
  });

  it("sets the controls it is handed in its header", () => {
    const html = render(diffSave(meta(), meta(), ABLETON), {
      actions: <button type="button">Changes</button>,
    });
    expect(html).toMatch(
      /<header.*<button type="button">Changes<\/button>.*<\/header>/
    );
  });
});
