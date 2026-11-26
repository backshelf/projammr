import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FORMAT_PREFS,
  formattersFor,
} from "@workspace/ui/lib/formatters";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SaveTimeline, type SaveTimelineEntry } from "./save-timeline";

const AS_OF = new Date(2026, 8, 23, 18, 0);

const entry = (
  id: number,
  at: Date,
  over: Partial<SaveTimelineEntry> = {}
): SaveTimelineEntry => ({
  id,
  fileUpdatedAt: at.toISOString(),
  machineName: null,
  source: "scan",
  chips: [],
  ...over,
});

const ENTRIES = [
  entry(3, new Date(2026, 8, 23, 14, 5), {
    machineName: "Studio Mac",
    chips: [{ kind: "tracks", label: "+1 track", sign: "add" }],
  }),
  entry(2, new Date(2026, 8, 22, 21, 40), { source: "backup" }),
  entry(1, new Date(2026, 8, 15, 9, 0)),
];

describe("SaveTimeline", () => {
  it("groups saves by local day, naming today and yesterday", () => {
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={ENTRIES}
        hrefFor={(e) => `/saves/${e.id}`}
        asOf={AS_OF}
      />
    );
    const labels = [...html.matchAll(/pt-4 pb-1 text-ink-soft">([^<]+)</g)].map(
      (match) => match[1]
    );
    // Bun on Linux writes "Sept", Bun on macOS (the system's ICU) "Sep".
    expect(labels).toEqual([
      "Today",
      "Yesterday",
      expect.stringMatching(/^Tue 15 Sept?$/),
    ]);
  });

  it("reads days and times in the formatter set it is handed", () => {
    const at = "2026-09-23T14:05:00Z";
    const format = formattersFor(
      { ...DEFAULT_FORMAT_PREFS, clock: "12h" },
      "Asia/Tokyo"
    );
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={[entry(1, new Date(at))]}
        hrefFor={(e) => `/saves/${e.id}`}
        asOf={new Date("2026-09-23T16:00:00Z")}
        format={format}
      />
    );
    // 14:05 UTC is 23:05 in Tokyo, on the day an hour later is already past.
    expect(html).toContain(">11:05 pm<");
    expect(html).toContain(">Yesterday<");
  });

  it("links each save out through a plain anchor when no link is handed over", () => {
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={ENTRIES}
        hrefFor={(e) => `/saves/${e.id}`}
        asOf={AS_OF}
      />
    );
    expect(html).toContain('<a href="/saves/3"');
    expect(html).toContain('<a href="/saves/1"');
  });

  it("links each save through the link it is handed", () => {
    function RouterLink(props: {
      href: string;
      className?: string;
      children?: ReactNode;
    }) {
      return (
        <a data-router="" {...props}>
          {props.children}
        </a>
      );
    }
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={ENTRIES}
        hrefFor={(e) => `/saves/${e.id}`}
        link={RouterLink}
        asOf={AS_OF}
      />
    );
    expect(html.match(/data-router=""/g)?.length).toBe(3);
  });

  it("draws each save's time, machine, backup flag and diff chips", () => {
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={ENTRIES}
        hrefFor={(e) => `/saves/${e.id}`}
        asOf={AS_OF}
      />
    );
    expect(html).toContain("14:05");
    expect(html).toContain("Studio Mac");
    expect(html).toContain("Backup");
    expect(html).toContain("+1 track");
    expect(html).toContain("Saved, nothing tracked changed");
  });

  it("flags a dit save, and leaves scan and app saves unflagged", () => {
    const html = (source: SaveTimelineEntry["source"]) =>
      renderToStaticMarkup(
        <SaveTimeline
          entries={[entry(1, new Date(2026, 8, 23, 14, 5), { source })]}
          hrefFor={(e) => `/saves/${e.id}`}
          asOf={AS_OF}
        />
      );
    expect(html("dit")).toContain(">dit<");
    expect(html("scan")).not.toContain(">dit<");
    expect(html("app")).not.toContain(">dit<");
    expect(html("app")).not.toContain("Backup");
  });

  it("lights the left edge of a marked save", () => {
    const html = renderToStaticMarkup(
      <SaveTimeline
        entries={ENTRIES}
        hrefFor={(e) => `/saves/${e.id}`}
        marked={new Set([2])}
        asOf={AS_OF}
      />
    );
    expect(html.match(/border-l-art/g)?.length).toBe(1);
  });

  it("renders nothing with no saves", () => {
    expect(
      renderToStaticMarkup(
        <SaveTimeline entries={[]} hrefFor={() => "/"} asOf={AS_OF} />
      )
    ).toBe("");
  });

  // Each case renders the same saves in two zones a day apart. A timeline
  // that ignored the zone it was given would render both the same, in the
  // runner's zone, so one of the two expectations fails wherever it runs.
  describe("with a time zone", () => {
    const dayLabels = (html: string) =>
      [...html.matchAll(/pt-4 pb-1 text-ink-soft">([^<]+)</g)].map(
        (match) => match[1]
      );

    it("groups and times the saves in the zone it is given", () => {
      // 21:05 and 08:30 on a Sunday at UTC+10 are 04:05 on that Sunday and
      // 15:30 on the Saturday before in Los Angeles.
      const saves = [
        entry(2, new Date("2026-06-14T21:05:00+10:00")),
        entry(1, new Date("2026-06-14T08:30:00+10:00")),
      ];
      const render = (timeZone: string) =>
        renderToStaticMarkup(
          <SaveTimeline
            entries={saves}
            hrefFor={() => "/"}
            asOf={new Date("2026-06-20T12:00:00+10:00")}
            timeZone={timeZone}
          />
        );

      const east = render("Etc/GMT-10");
      expect(dayLabels(east)).toEqual(["Sun 14 Jun"]);
      expect(east).toContain("21:05");
      expect(east).toContain("08:30");

      const west = render("America/Los_Angeles");
      expect(dayLabels(west)).toEqual(["Sun 14 Jun", "Sat 13 Jun"]);
      expect(west).toContain("04:05");
      expect(west).toContain("15:30");
    });

    it("names today by the calendar of the zone it is given", () => {
      // At UTC+10 the save and the moment it is read are both on Sunday; in
      // Los Angeles the save is on Saturday and the reading on Sunday.
      const render = (timeZone: string) =>
        renderToStaticMarkup(
          <SaveTimeline
            entries={[entry(1, new Date("2026-06-14T08:30:00+10:00"))]}
            hrefFor={() => "/"}
            asOf={new Date("2026-06-14T20:00:00+10:00")}
            timeZone={timeZone}
          />
        );
      expect(dayLabels(render("Etc/GMT-10"))).toEqual(["Today"]);
      expect(dayLabels(render("America/Los_Angeles"))).toEqual(["Yesterday"]);
    });
  });
});
