import {
  renderToPlayable,
  type TodayRender,
} from "@/components/project-home/playable";
import { describe, expect, it } from "bun:test";

const render = (overrides: Partial<TodayRender> = {}): TodayRender => ({
  id: 41,
  createdAt: "2026-09-26T01:00:00.000Z",
  updatedAt: "2026-09-26T01:00:00.000Z",
  trackId: 7,
  assetId: 300,
  version: 4,
  isPrimary: false,
  primaryPinned: false,
  bouncedFromSaveId: null,
  bouncedFrom: null,
  durationMs: 181_000,
  lufs: -14,
  lra: null,
  truePeakDb: null,
  analysisVersion: null,
  bpm: null,
  bpmConfidence: null,
  beatOffsetMs: null,
  musicalKey: null,
  keyConfidence: null,
  silence: null,
  spectrogramKey: null,
  spectrogramBytes: 0,
  duplicateOfId: null,
  asset: {
    id: 300,
    createdAt: "2026-09-26T01:00:00.000Z",
    updatedAt: "2026-09-26T01:00:00.000Z",
    name: "mix-v4.wav",
    type: "audio/wav",
    size: 1024,
    assetPath: "assets/mix-v4.wav",
    createdByUser: null,
    projectId: 1,
    localFilepath: null,
    localFileCreatedAt: null,
    localFileUpdatedAt: null,
    localFileMachineName: null,
    fingerprint: null,
  },
  owner: {
    trackId: 7,
    title: "Harbour Lights",
    artists: ["Wren"],
    album: "Night Shift",
    collectionId: 12,
    projectId: 1,
    artwork: {
      assetPath: "images/harbour.jpg",
      accentHue: 210,
      accentChroma: 0.08,
    },
  },
  ...overrides,
});

describe("renderToPlayable", () => {
  it("pins the row's own audio id, version and primary flag", () => {
    const playable = renderToPlayable(render({ id: 41, version: 4 }));

    expect(playable.trackAudio).toEqual({
      id: 41,
      version: 4,
      isPrimary: false,
    });
  });

  it("carries the primary flag of a row that is the primary", () => {
    const playable = renderToPlayable(render({ isPrimary: true }));

    expect(playable.trackAudio?.isPrimary).toBe(true);
  });

  it("plays the row's asset for its track", () => {
    const row = render();
    const playable = renderToPlayable(row);

    expect(playable.asset).toBe(row.asset);
    expect(playable.ownerType).toBe("track");
    expect(playable.ownerId).toBe(7);
  });

  it("maps the owner's title, artists, album, ids and cover", () => {
    const playable = renderToPlayable(render());

    expect(playable).toMatchObject({
      title: "Harbour Lights",
      artists: ["Wren"],
      album: "Night Shift",
      projectId: 1,
      collectionId: 12,
      cover: "images/harbour.jpg",
      accentHue: 210,
      accentChroma: 0.08,
      metadataResolved: true,
    });
  });

  it("has no cover, title or artists when the owner is null", () => {
    const playable = renderToPlayable(render({ owner: null }));

    expect(playable.cover).toBeUndefined();
    expect(playable.title).toBeUndefined();
    expect(playable.artists).toBeUndefined();
    expect(playable.trackAudio?.id).toBe(41);
    expect(playable.ownerId).toBe(7);
  });
});
