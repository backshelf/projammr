import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "bun:test";
import type { CollectionSummary, TracksPage } from "@workspace/api/api";
import { ProjectRailCounts } from "./ProjectRailCounts";

describe("ProjectRailCounts", () => {
  it("counts distinct project tracks from trackCountPromise rather than summing collections", async () => {
    const collections = [
      { id: 1, title: "EP", trackCount: 4 },
      { id: 2, title: "Live", trackCount: 4 },
    ] as CollectionSummary[];
    const tracksPage = { rowCount: 5 } as TracksPage;

    const element = await ProjectRailCounts({
      name: "Album",
      collectionsPromise: Promise.resolve(collections),
      trackCountPromise: Promise.resolve(tracksPage),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("2 collections · 5 tracks");
    expect(html).not.toContain("8 tracks");
  });
});
