import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { saves } from "../../db/schema/saves.js";
import type { Session } from "../../db/schema/sessions.js";
import { trackAudios, tracks } from "../../db/schema/tracks.js";
import { setupSuite } from "../../test/fixtures.js";
import {
  deriveTrackMusicMeta,
  getQuietTracks,
  getTracksPage,
  trackQuerySchema,
} from "./queries.js";

type MusicSession = Pick<Session, "main" | "rootNote" | "scale" | "tempo">;

const session = (fields: Partial<MusicSession> = {}): MusicSession => ({
  main: false,
  rootNote: null,
  scale: null,
  tempo: null,
  ...fields,
});

const NO_KEY = { key: null, keyTonic: null, keyScale: null };

describe("deriveTrackMusicMeta", () => {
  it("reads the key, its two halves and the tempo off the main session", () => {
    expect(
      deriveTrackMusicMeta([
        session({ main: true, rootNote: "C", scale: "minor", tempo: "128" }),
      ])
    ).toEqual({
      key: "C minor",
      keyTonic: "C",
      keyScale: "minor",
      bpm: "128",
    });
  });

  it("takes the main session over the others whatever their order", () => {
    const others = [
      session({ rootNote: "F", scale: "major", tempo: "90" }),
      session({ rootNote: "G", scale: "major", tempo: "95" }),
    ];
    const main = session({
      main: true,
      rootNote: "A",
      scale: "minor",
      tempo: "174",
    });
    const expected = {
      key: "A minor",
      keyTonic: "A",
      keyScale: "minor",
      bpm: "174",
    };

    expect(deriveTrackMusicMeta([...others, main])).toEqual(expected);
    expect(deriveTrackMusicMeta([main, ...others])).toEqual(expected);
  });

  it("derives nothing from a track with no sessions", () => {
    expect(deriveTrackMusicMeta([])).toEqual({ ...NO_KEY, bpm: null });
  });

  it("derives nothing when no session is the main one", () => {
    // The non-main sessions are not a fallback: a track without a main session
    // reports no key, rather than borrowing another session's.
    expect(
      deriveTrackMusicMeta([
        session({ rootNote: "D", scale: "dorian", tempo: "140" }),
      ])
    ).toEqual({ ...NO_KEY, bpm: null });
  });

  it("keeps whichever half of the key the main session carries", () => {
    expect(
      deriveTrackMusicMeta([session({ main: true, rootNote: "E#" })])
    ).toEqual({ key: "E#", keyTonic: "E#", keyScale: null, bpm: null });

    expect(
      deriveTrackMusicMeta([session({ main: true, scale: "phrygian" })])
    ).toEqual({
      key: "phrygian",
      keyTonic: null,
      keyScale: "phrygian",
      bpm: null,
    });
  });

  it("reports no key when the main session has neither half", () => {
    expect(
      deriveTrackMusicMeta([session({ main: true, tempo: "100" })])
    ).toEqual({ ...NO_KEY, bpm: "100" });
  });

  it("reads an empty half as none", () => {
    expect(
      deriveTrackMusicMeta([session({ main: true, rootNote: "", scale: "" })])
    ).toEqual({ ...NO_KEY, bpm: null });
  });
});

describe("getQuietTracks", () => {
  const suite = setupSuite("Quiet tracks");

  const BEFORE = new Date("2026-08-27T00:00:00.000Z");
  const LONG_AGO = new Date("2026-05-01T00:00:00.000Z");
  const RECENT = new Date("2026-09-20T00:00:00.000Z");
  const day = (n: number) => new Date(LONG_AGO.getTime() + n * 86_400_000);

  const quiet = (limit = 50) =>
    getQuietTracks(suite.projectId, { before: BEFORE, limit });

  /** Every test reads the project's quiet list whole, so it starts empty. */
  beforeEach(async () => {
    await db.delete(tracks).where(eq(tracks.projectId, suite.projectId));
  });

  /**
   * A track whose newest touch is `updatedAt` unless a save or a render linked
   * says otherwise; everything is backdated straight on the rows.
   */
  async function mkQuietTrack(
    title: string,
    touch: {
      updatedAt?: Date;
      saveAt?: Date;
      renderAt?: Date;
      percentage?: number;
    } = {}
  ) {
    const trackId = await suite.mkTrack(title);
    if (touch.saveAt) {
      const session = await suite.mkSession({ trackId });
      await db.insert(saves).values({
        sessionId: session.id,
        projectId: suite.projectId,
        fileUpdatedAt: touch.saveAt,
        source: "scan",
      });
    }
    if (touch.renderAt) {
      await suite.mkPrimaryAudioWithLoudness(trackId, -14);
      await db
        .update(trackAudios)
        .set({ createdAt: touch.renderAt })
        .where(eq(trackAudios.trackId, trackId));
    }
    const status =
      touch.percentage === undefined
        ? null
        : await suite.mkStatus(title, touch.percentage);
    await db
      .update(tracks)
      .set({
        updatedAt: touch.updatedAt ?? LONG_AGO,
        // A new track starts on the default status; without a percentage it has none.
        statusId: status?.id ?? null,
      })
      .where(eq(tracks.id, trackId));
    return trackId;
  }

  it("lists a track quiet on updated_at alone, with its artists and no status", async () => {
    const id = await mkQuietTrack("Only updated");

    const { tracks: rows, total } = await quiet();

    expect(total).toBe(1);
    expect(rows).toEqual([
      {
        id,
        title: "Only updated",
        artists: ["A"],
        artwork: null,
        status: null,
        lastTouchedAt: LONG_AGO,
      },
    ]);
  });

  it("carries the status of a track that has one", async () => {
    const id = await mkQuietTrack("Halfway", { percentage: 40 });

    const { tracks: rows } = await quiet();

    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(rows[0]?.status).toMatchObject({ percentage: 40 });
  });

  it("dates a track by its newest touch, not its oldest", async () => {
    await mkQuietTrack("Saved since", {
      updatedAt: day(1),
      saveAt: day(5),
      renderAt: day(3),
    });

    const { tracks: rows } = await quiet();

    expect(rows.map((row) => row.lastTouchedAt)).toEqual([day(5)]);
  });

  it("drops a quiet track once a recent save rescues it", async () => {
    await mkQuietTrack("Saved lately", { saveAt: RECENT });

    expect(await quiet()).toEqual({ tracks: [], total: 0 });
  });

  it("drops a quiet track once a recent render rescues it", async () => {
    await mkQuietTrack("Rendered lately", { renderAt: RECENT });

    expect(await quiet()).toEqual({ tracks: [], total: 0 });
  });

  it("leaves an archived track out", async () => {
    const id = await mkQuietTrack("Shelved");
    await db
      .update(tracks)
      .set({ archivedAt: LONG_AGO })
      .where(eq(tracks.id, id));

    expect(await quiet()).toEqual({ tracks: [], total: 0 });
  });

  it("counts a track as done at 100 and beyond, and a status-less one as not", async () => {
    await mkQuietTrack("Exactly done", { percentage: 100 });
    await mkQuietTrack("Over done", { percentage: 120 });
    const almost = await mkQuietTrack("Almost", { percentage: 99 });
    const none = await mkQuietTrack("No status");

    const { tracks: rows, total } = await quiet();

    expect(rows.map((row) => row.id).sort()).toEqual([almost, none].sort());
    expect(total).toBe(2);
  });

  it("orders oldest first, breaking a tie by id", async () => {
    const newer = await mkQuietTrack("Newer", { updatedAt: day(9) });
    const tiedFirst = await mkQuietTrack("Tied first", { updatedAt: day(4) });
    const tiedSecond = await mkQuietTrack("Tied second", {
      updatedAt: day(4),
    });
    const oldest = await mkQuietTrack("Oldest", { updatedAt: day(1) });

    const { tracks: rows } = await quiet();

    expect(rows.map((row) => row.id)).toEqual([
      oldest,
      tiedFirst,
      tiedSecond,
      newer,
    ]);
  });

  it("caps the rows but counts every quiet track in total", async () => {
    const oldest = await mkQuietTrack("One", { updatedAt: day(1) });
    const second = await mkQuietTrack("Two", { updatedAt: day(2) });
    await mkQuietTrack("Three", { updatedAt: day(3) });

    const { tracks: rows, total } = await quiet(2);

    expect(rows.map((row) => row.id)).toEqual([oldest, second]);
    expect(total).toBe(3);
  });
});

describe("getTracksPage audit filters and flags", () => {
  const suite = setupSuite("Track audit filters");

  beforeEach(async () => {
    await db.delete(tracks).where(eq(tracks.projectId, suite.projectId));
  });

  const pageWith = (params: Record<string, unknown>) =>
    getTracksPage(suite.projectId, trackQuerySchema.parse(params));

  it("treats null notes and empty block arrays as hasNotes: false and non-empty arrays as true", async () => {
    const nullNotes = await suite.mkTrack("Null notes");
    const emptyNotes = await suite.mkTrack("Empty notes");
    const withNotes = await suite.mkTrack("With notes");

    await db.update(tracks).set({ notes: [] }).where(eq(tracks.id, emptyNotes));
    await db
      .update(tracks)
      .set({
        notes: [
          { type: "paragraph", content: [{ type: "text", text: "Draft" }] },
        ],
      })
      .where(eq(tracks.id, withNotes));

    const all = await pageWith({});
    const byId = new Map(all.rows.map((r) => [r.id, r]));
    expect(byId.get(nullNotes)?.hasNotes).toBe(false);
    expect(byId.get(emptyNotes)?.hasNotes).toBe(false);
    expect(byId.get(withNotes)?.hasNotes).toBe(true);

    const onlyWith = await pageWith({ hasNotes: "true" });
    expect(onlyWith.rows.map((r) => r.id)).toEqual([withNotes]);

    const onlyWithout = await pageWith({ hasNotes: false });
    expect(onlyWithout.rows.map((r) => r.id).sort()).toEqual(
      [nullNotes, emptyNotes].sort()
    );
  });

  it("counts audio versions per track and filters by hasAudio, hasImage, and hasSessions", async () => {
    const plain = await suite.mkTrack("Plain");
    const media = await suite.mkTrack("With media");

    await db
      .update(tracks)
      .set({ image: "images/test-cover.jpg" })
      .where(eq(tracks.id, media));
    await suite.mkPrimaryAudioWithLoudness(media, -12);
    await suite.mkSession({ trackId: media, main: true });

    const all = await pageWith({});
    const byId = new Map(all.rows.map((r) => [r.id, r]));
    expect(byId.get(plain)?.audioCount).toBe(0);
    expect(byId.get(media)?.audioCount).toBe(1);

    expect((await pageWith({ hasImage: true })).rows.map((r) => r.id)).toEqual([
      media,
    ]);
    expect((await pageWith({ hasImage: false })).rows.map((r) => r.id)).toEqual(
      [plain]
    );
    expect((await pageWith({ hasAudio: true })).rows.map((r) => r.id)).toEqual([
      media,
    ]);
    expect((await pageWith({ hasAudio: false })).rows.map((r) => r.id)).toEqual(
      [plain]
    );
    expect(
      (await pageWith({ hasSessions: true })).rows.map((r) => r.id)
    ).toEqual([media]);
    expect(
      (await pageWith({ hasSessions: false })).rows.map((r) => r.id)
    ).toEqual([plain]);
  });
});
