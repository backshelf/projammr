import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SaveRowBody } from "./save-row-body";

const BASE = {
  at: "2026-10-21T20:47:00.000Z",
  stamp: "22:47",
  machineName: null,
} as const;

describe("SaveRowBody", () => {
  it("marks a dit save with its source chip and a scan with none", () => {
    const dit = renderToStaticMarkup(
      <SaveRowBody {...BASE} source="dit" chips={[]} />
    );
    const scan = renderToStaticMarkup(
      <SaveRowBody {...BASE} source="scan" chips={[]} />
    );
    expect(dit).toContain(">dit<");
    expect(scan).not.toContain(">dit<");
  });

  it("draws no source chip when the list names no source", () => {
    const html = renderToStaticMarkup(<SaveRowBody {...BASE} chips={[]} />);
    expect(html).not.toContain(">dit<");
    expect(html).not.toContain(">Backup<");
  });

  it("says nothing tracked changed unless the list words it", () => {
    const standard = renderToStaticMarkup(
      <SaveRowBody {...BASE} source="scan" chips={[]} />
    );
    const custom = renderToStaticMarkup(
      <SaveRowBody {...BASE} chips={[]} empty="Saved, nothing changed" />
    );
    expect(standard).toContain("Saved, nothing tracked changed");
    expect(custom).toContain("Saved, nothing changed");
    expect(custom).not.toContain("tracked");
  });

  it("keeps the chips in place of the empty line", () => {
    const html = renderToStaticMarkup(
      <SaveRowBody
        {...BASE}
        chips={[{ kind: "tracks", label: "+2 tracks", sign: "add" }]}
        empty="Saved, nothing changed"
      />
    );
    expect(html).toContain("+2 tracks");
    expect(html).not.toContain("Saved, nothing changed");
  });
});
