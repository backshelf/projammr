import { describe, expect, it } from "bun:test";
import { shareEntries } from "./share-playables";
import type { SharelinkTrack } from "@workspace/api/api";

const track = (trackAudio: SharelinkTrack["trackAudio"]): SharelinkTrack => ({
  id: 1,
  title: "Take Two",
  trackAudio,
  artwork: null,
});

describe("shareEntries", () => {
  it("carries the version, date and duration a listener needs to tell mixes apart", () => {
    const [entry] = shareEntries("tok", [
      track({
        id: 5,
        assetId: 9,
        version: 3,
        createdAt: "2026-01-02T00:00:00.000Z",
        durationMs: 40_000,
      }),
    ]);

    expect(entry?.version).toBe(3);
    expect(entry?.createdAt).toBe("2026-01-02T00:00:00.000Z");
    expect(entry?.durationMs).toBe(40_000);
  });

  it("falls back to null rather than a made-up version or date", () => {
    const [entry] = shareEntries("tok", [track({ id: 5, assetId: 9 })]);

    expect(entry?.version).toBeNull();
    expect(entry?.createdAt).toBeNull();
    expect(entry?.durationMs).toBeNull();
  });

  it("drops a track with no audio behind it", () => {
    expect(shareEntries("tok", [track({})])).toEqual([]);
  });
});
