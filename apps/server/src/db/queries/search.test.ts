import { eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { comments } from "../schema/comments.js";
import { images } from "../schema/images.js";
import { projects } from "../schema/projects.js";
import { sessions } from "../schema/sessions.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import { searchComments, searchProject, searchTracks } from "./search.js";

/**
 * All rows live under one seeded project (plus one row in a second project,
 * to prove scoping works). Deleted in afterAll via the project's cascade.
 */
let projectId: number;
let priorityId: number;
let otherProjectId: number;
let commentTrackId: number;
let commentCollectionId: number;
let commentSessionId: number;
let commentTrackAudioId: number;
let commentAudioParentTrackId: number;
let otherProjectTrackId: number;
let ownImageTrackId: number;
let inheritedImageTrackId: number;
let imagedCollectionId: number;

const COMMENT_MARKER = "xylophone-marker";

/**
 * A block of tracks big enough that returning every match would be visible:
 * `BULK_MATCHING` of them match `BULK_MATCH_TITLE` and the rest match nothing,
 * so a searcher that trims in JS would have to carry 50 rows out of the
 * database to hand back 8.
 */
const BULK_MATCH_TITLE = "Marimba Sketch";
const BULK_MATCHING = 50;
const BULK_TOTAL = 300;

/** The statement text of one spied `Client.prototype.query` call. */
function sqlTextOf(call: unknown[]): string {
  const [first] = call;
  if (typeof first === "string") return first;
  if (first != null && typeof first === "object" && "text" in first) {
    return String((first as { text: unknown }).text);
  }
  return "";
}

beforeAll(async () => {
  const [project] = await db
    .insert(projects)
    .values({ name: `Search Test ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  priorityId = await seedScale(projectId);

  const [otherProject] = await db
    .insert(projects)
    .values({ name: `Search Test Other ${Date.now()}` })
    .returning({ id: projects.id });
  otherProjectId = otherProject!.id;
  const otherPriorityId = await seedScale(otherProjectId);

  const blockNoteNotes = (text: string) => [
    { type: "paragraph", content: [{ type: "text", text, styles: {} }] },
  ];

  await db.insert(tracks).values([
    { title: "Low Tide", artists: [], projectId, priorityId },
    {
      title: "Untitled Session Sketch",
      artists: [],
      notes: blockNoteNotes("revisit the low tide bridge section"),
      projectId,
      priorityId,
    },
    {
      title: "Other Project Track",
      artists: [],
      projectId: otherProjectId,
      priorityId: otherPriorityId,
    },
  ]);

  await db
    .insert(collections)
    .values([{ title: "Reference EP", projectId, priorityId }]);

  // A collection with its own image, and a track that has no image of its
  // own but belongs to that collection — proves the fallback chain (own →
  // first collection → project) resolves the collection's artwork.
  const [imagedCollection] = await db
    .insert(collections)
    .values({ title: "Imaged Collection", projectId, priorityId })
    .returning({ id: collections.id });
  imagedCollectionId = imagedCollection!.id;

  await db.insert(images).values({
    assetPath: "images/collection-cover.png",
    name: "collection-cover.png",
    type: "image/png",
    size: 1,
    projectId,
    accentHue: 210,
    accentChroma: 0.1,
    accentHex: "#336699",
  });
  await db
    .update(collections)
    .set({ image: "images/collection-cover.png" })
    .where(eq(collections.id, imagedCollectionId));

  await db.insert(images).values({
    assetPath: "images/track-cover.png",
    name: "track-cover.png",
    type: "image/png",
    size: 1,
    projectId,
    accentHue: 30,
    accentChroma: 0.15,
    accentHex: "#cc7722",
  });
  const [ownImageTrack] = await db
    .insert(tracks)
    .values({
      title: "Own Image Track",
      artists: [],
      projectId,
      priorityId,
      image: "images/track-cover.png",
    })
    .returning({ id: tracks.id });
  ownImageTrackId = ownImageTrack!.id;

  const [inheritedImageTrack] = await db
    .insert(tracks)
    .values({
      title: "Inherited Image Track",
      artists: [],
      projectId,
      priorityId,
    })
    .returning({ id: tracks.id });
  inheritedImageTrackId = inheritedImageTrack!.id;
  await db.insert(collectionTracks).values({
    collectionId: imagedCollectionId,
    trackId: inheritedImageTrackId,
  });

  const manySessionNames = Array.from(
    { length: 10 },
    (_, i) => `Bounce Take ${i + 1}`
  );
  await db.insert(sessions).values(
    manySessionNames.map((name) => ({
      name,
      daw: "Ableton" as const,
      projectId,
      priorityId,
    }))
  );

  await db.insert(assets).values([
    {
      name: "reference.wav",
      type: "audio/wav",
      size: 1,
      assetPath: "assets/reference.wav",
      projectId,
    },
  ]);

  await db.insert(tracks).values(
    Array.from({ length: BULK_TOTAL }, (_, i) => ({
      title:
        i < BULK_MATCHING
          ? `${BULK_MATCH_TITLE} ${i + 1}`
          : `Unrelated Bulk ${i + 1}`,
      artists: [] as string[],
      projectId,
      priorityId,
    }))
  );

  const [commentTrack] = await db
    .insert(tracks)
    .values({
      title: "Comment Target Track",
      artists: [],
      projectId,
      priorityId,
    })
    .returning({ id: tracks.id });
  commentTrackId = commentTrack!.id;

  const [commentCollection] = await db
    .insert(collections)
    .values({ title: "Comment Target Collection", projectId, priorityId })
    .returning({ id: collections.id });
  commentCollectionId = commentCollection!.id;

  const [commentSession] = await db
    .insert(sessions)
    .values({
      name: "Comment Target Session",
      daw: "Ableton" as const,
      projectId,
      priorityId,
    })
    .returning({ id: sessions.id });
  commentSessionId = commentSession!.id;

  const [audioAsset] = await db
    .insert(assets)
    .values({
      name: "comment-audio.wav",
      type: "audio/wav",
      size: 1,
      assetPath: "assets/comment-audio.wav",
      projectId,
    })
    .returning({ id: assets.id });

  const [commentAudioParentTrack] = await db
    .insert(tracks)
    .values({
      title: "Comment Audio Parent Track",
      artists: [],
      projectId,
      priorityId,
    })
    .returning({ id: tracks.id });
  commentAudioParentTrackId = commentAudioParentTrack!.id;

  const [trackAudio] = await db
    .insert(trackAudios)
    .values({
      trackId: commentAudioParentTrack!.id,
      assetId: audioAsset!.id,
      version: 1,
    })
    .returning({ id: trackAudios.id });
  commentTrackAudioId = trackAudio!.id;

  const [otherProjectTrack] = await db
    .insert(tracks)
    .values({
      title: "Cross-Project Comment Track",
      artists: [],
      projectId: otherProjectId,
      priorityId: otherPriorityId,
    })
    .returning({ id: tracks.id });
  otherProjectTrackId = otherProjectTrack!.id;

  await db.insert(comments).values([
    {
      targetType: "collection",
      targetId: commentCollectionId,
      projectId,
      content: `notes about ${COMMENT_MARKER} mixing`,
    },
    {
      targetType: "track",
      targetId: commentTrackId,
      projectId,
      content: `the ${COMMENT_MARKER} arrangement needs work`,
    },
    {
      targetType: "session",
      targetId: commentSessionId,
      projectId,
      content: `${COMMENT_MARKER} tempo drifted here`,
    },
    {
      targetType: "track_audio",
      targetId: commentTrackAudioId,
      projectId,
      content: `${COMMENT_MARKER} clip at this point`,
      positionMs: 65000,
    },
    {
      targetType: "project",
      targetId: projectId,
      projectId,
      content: `project-level ${COMMENT_MARKER} note`,
    },
    {
      targetType: "track",
      targetId: otherProjectTrackId,
      projectId: otherProjectId,
      content: `${COMMENT_MARKER} comment on a track in another project`,
    },
  ]);
});

afterAll(async () => {
  const ids = [projectId, otherProjectId];
  await db
    .delete(comments)
    .where(
      inArray(comments.targetId, [
        commentCollectionId,
        commentTrackId,
        commentSessionId,
        commentTrackAudioId,
        projectId,
        otherProjectTrackId,
      ])
    );
  await db.delete(trackAudios).where(eq(trackAudios.id, commentTrackAudioId));
  await db.delete(tracks).where(inArray(tracks.projectId, ids));
  await db.delete(collections).where(inArray(collections.projectId, ids));
  await db.delete(sessions).where(inArray(sessions.projectId, ids));
  await db.delete(projects).where(inArray(projects.id, ids));
});

describe("searchComments", () => {
  it("finds a comment on each of the five target types, scoped to the right project", async () => {
    const results = await searchComments(projectId, COMMENT_MARKER, 20);

    expect(
      results.some(
        (r) => r.type === "collection" && r.id === commentCollectionId
      )
    ).toBe(true);
    expect(
      results.some((r) => r.type === "track" && r.id === commentTrackId)
    ).toBe(true);
    expect(
      results.some((r) => r.type === "session" && r.id === commentSessionId)
    ).toBe(true);
    // track_audio comments surface as their parent track.
    expect(
      results.some(
        (r) => r.type === "track" && r.id === commentAudioParentTrackId
      )
    ).toBe(true);
    // project-level comments have no track/collection/session to attach to.
    expect(results.every((r) => r.projectId === projectId)).toBe(true);
  });

  it("uses positionMs as the subtitle for a track_audio comment", async () => {
    const results = await searchComments(projectId, COMMENT_MARKER, 20);
    const audioResult = results.find((r) => r.id === commentAudioParentTrackId);
    expect(audioResult?.subtitle).toBe("1:05");
  });

  it("never returns a comment scoped to another project", async () => {
    const results = await searchComments(projectId, COMMENT_MARKER, 20);
    expect(results.some((r) => r.id === otherProjectTrackId)).toBe(false);
  });

  it("resolves every comment's project with a bounded number of queries, not one per row", async () => {
    // The search runs inside a transaction, which a pool-level spy never sees:
    // `Pool.query` delegates to a checked-out client, so the statements are
    // issued on `Client.prototype.query`.
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    await searchComments(projectId, COMMENT_MARKER, 20);

    // The joined comment search and at most one follow-up for track_audio
    // parent titles, plus the transaction's own begin/commit and the threshold
    // — never proportional to row count.
    const selects = querySpy.mock.calls.filter((call) =>
      /^\s*select/i.test(sqlTextOf(call))
    );
    expect(selects.length).toBeLessThanOrEqual(3);
    querySpy.mockRestore();
  });

  it("scopes to the project in SQL rather than filtering afterwards", async () => {
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    await searchComments(projectId, COMMENT_MARKER, 20);

    const commentStatement = querySpy.mock.calls
      .map(sqlTextOf)
      .find((text) => /from "comments"/i.test(text));

    expect(commentStatement).toBeDefined();
    expect(commentStatement).toMatch(/"comments"\."project_id"/);
    querySpy.mockRestore();
  });

  it("flags every result as isComment", async () => {
    const results = await searchComments(projectId, COMMENT_MARKER, 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.isComment === true)).toBe(true);
  });
});

describe("searchProject", () => {
  it("ranks an exact title match first", async () => {
    const results = await searchProject(projectId, "Low Tide", ["track"], 20);
    expect(results[0]?.title).toBe("Low Tide");
  });

  it("finds a row via a typo", async () => {
    const results = await searchProject(projectId, "lwo tide", ["track"], 20);
    expect(results.some((r) => r.title === "Low Tide")).toBe(true);
  });

  it("ranks a title match above a body-only match for the same query", async () => {
    const results = await searchProject(projectId, "low tide", ["track"], 20);
    const titleHit = results.findIndex((r) => r.title === "Low Tide");
    const bodyHit = results.findIndex(
      (r) => r.title === "Untitled Session Sketch"
    );
    expect(titleHit).toBeGreaterThanOrEqual(0);
    expect(bodyHit).toBeGreaterThanOrEqual(0);
    expect(titleHit).toBeLessThan(bodyHit);
  });

  it("caps results per type at 8", async () => {
    const results = await searchProject(
      projectId,
      "Bounce Take",
      ["session"],
      100
    );
    expect(results.length).toBe(8);
  });

  it("never returns a row from a different project", async () => {
    const results = await searchProject(
      projectId,
      "Other Project Track",
      ["track"],
      20
    );
    expect(results.some((r) => r.title === "Other Project Track")).toBe(false);
  });

  it("resolves a track's own image with its accent colours", async () => {
    const results = await searchProject(
      projectId,
      "Own Image Track",
      ["track"],
      20
    );
    const result = results.find((r) => r.id === ownImageTrackId);
    expect(result?.image).toMatchObject({
      assetPath: "images/track-cover.png",
      accentHue: 30,
    });
  });

  it("falls back to a track's first collection's image when it has none of its own", async () => {
    const results = await searchProject(
      projectId,
      "Inherited Image Track",
      ["track"],
      20
    );
    const result = results.find((r) => r.id === inheritedImageTrackId);
    expect(result?.image).toMatchObject({
      assetPath: "images/collection-cover.png",
      accentHue: 210,
    });
  });

  it("resolves a collection's own image", async () => {
    const results = await searchProject(
      projectId,
      "Imaged Collection",
      ["collection"],
      20
    );
    const result = results.find((r) => r.id === imagedCollectionId);
    expect(result?.image).toMatchObject({
      assetPath: "images/collection-cover.png",
      accentHue: 210,
    });
  });

  it("resolves image as null for a row with nothing in its fallback chain", async () => {
    const results = await searchProject(projectId, "Low Tide", ["track"], 20);
    const result = results.find((r) => r.title === "Low Tide");
    expect(result?.image).toBeNull();
  });

  it("short-circuits queries below the minimum length", async () => {
    const results = await searchProject(projectId, "a", ["track"], 20);
    expect(results).toEqual([]);
  });
});

describe("archived results", () => {
  const QUERY = "Quokka Chorus";
  let liveTrackId: number;
  let archivedTrackId: number;
  let liveSessionId: number;
  let archivedSessionId: number;
  let orphanSessionId: number;

  beforeAll(async () => {
    // The archived rows match the query better than the live ones, so only
    // the archive flag can be what puts them last.
    const [live, archived] = await db
      .insert(tracks)
      .values([
        {
          title: "Quokka Chorus Demo Take Two",
          artists: [],
          projectId,
          priorityId,
        },
        {
          title: "Quokka Chorus",
          artists: [],
          projectId,
          priorityId,
          archivedAt: new Date(),
        },
      ])
      .returning({ id: tracks.id });
    liveTrackId = live!.id;
    archivedTrackId = archived!.id;

    const sessionRows = await db
      .insert(sessions)
      .values([
        {
          name: "Quokka Chorus Live Session Extra",
          daw: "Ableton" as const,
          projectId,
          priorityId,
          trackId: liveTrackId,
        },
        {
          name: "Quokka Chorus",
          daw: "Ableton" as const,
          projectId,
          priorityId,
          trackId: archivedTrackId,
        },
        {
          name: "Quokka Chorus Loose Session Extra",
          daw: "Ableton" as const,
          projectId,
          priorityId,
        },
      ])
      .returning({ id: sessions.id });
    liveSessionId = sessionRows[0]!.id;
    archivedSessionId = sessionRows[1]!.id;
    orphanSessionId = sessionRows[2]!.id;

    await db.insert(comments).values([
      {
        targetType: "track",
        targetId: archivedTrackId,
        content: "quokka-comment-marker",
        projectId,
      },
      {
        targetType: "track",
        targetId: liveTrackId,
        content: "quokka-comment-marker",
        projectId,
      },
    ]);
  });

  it("flags an archived track and a session of one, and every other result live", async () => {
    const results = await searchProject(
      projectId,
      QUERY,
      ["track", "session", "collection", "asset"],
      50
    );
    const flag = (type: string, id: number) =>
      results.find((r) => r.type === type && r.id === id)?.archived;

    expect(flag("track", archivedTrackId)).toBe(true);
    expect(flag("session", archivedSessionId)).toBe(true);
    expect(flag("track", liveTrackId)).toBe(false);
    expect(flag("session", liveSessionId)).toBe(false);
    expect(flag("session", orphanSessionId)).toBe(false);
    expect(
      results
        .filter((r) => r.type === "collection" || r.type === "asset")
        .every((r) => !r.archived)
    ).toBe(true);
  });

  it("ranks every live result before the archived ones, even at a lower score", async () => {
    const results = await searchProject(
      projectId,
      QUERY,
      ["track", "session"],
      50
    );
    const liveScores = results.filter((r) => !r.archived);
    const archived = results.filter((r) => r.archived);
    expect(archived.length).toBeGreaterThanOrEqual(2);

    const firstArchived = results.findIndex((r) => r.archived);
    expect(results.slice(firstArchived).every((r) => r.archived)).toBe(true);

    const archivedTrack = results.find(
      (r) => r.type === "track" && r.id === archivedTrackId
    );
    const liveTrack = results.find(
      (r) => r.type === "track" && r.id === liveTrackId
    );
    expect(archivedTrack!.score).toBeGreaterThan(liveTrack!.score);
    expect(results.indexOf(liveTrack!)).toBeLessThan(
      results.indexOf(archivedTrack!)
    );
    expect(liveScores.length).toBeGreaterThan(0);

    for (const group of [liveScores, archived]) {
      const scores = group.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("keeps a live result inside the limit ahead of a better-scoring archived one", async () => {
    const results = await searchTracks(projectId, QUERY, 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(liveTrackId);
  });

  it("flags a comment result by whether its track is archived", async () => {
    const results = await searchComments(projectId, "quokka-comment-marker");
    const flag = (id: number) =>
      results.find((r) => r.type === "track" && r.id === id)?.archived;
    expect(flag(archivedTrackId)).toBe(true);
    expect(flag(liveTrackId)).toBe(false);
  });
});

describe("SQL-side limiting", () => {
  it("trims in the database, not after the rows have been fetched", async () => {
    const querySpy = spyOn(pg.Client.prototype, "query");
    querySpy.mockClear();

    const results = await searchTracks(projectId, BULK_MATCH_TITLE, 8);
    expect(results.length).toBe(8);

    const trackCall = querySpy.mock.calls.findIndex((call) =>
      /from "tracks"/i.test(sqlTextOf(call))
    );
    expect(trackCall).toBeGreaterThanOrEqual(0);

    // The point of moving LIMIT into SQL: the statement itself returns only
    // the head it needs, not all 50 matching rows.
    const result = (await querySpy.mock.results[trackCall]!.value) as {
      rows: unknown[];
    };
    expect(result.rows.length).toBeLessThanOrEqual(16);

    querySpy.mockRestore();
  });

  it("finds the bulk matches at all", async () => {
    const results = await searchTracks(projectId, BULK_MATCH_TITLE, 8);
    expect(results.every((r) => r.title.startsWith(BULK_MATCH_TITLE))).toBe(
      true
    );
  });
});

describe("similarity threshold scoping", () => {
  it("gives the same answer twice, so the setting does not leak between searches", async () => {
    const first = await searchTracks(projectId, BULK_MATCH_TITLE, 8);
    const second = await searchTracks(projectId, BULK_MATCH_TITLE, 8);

    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it("leaves the pooled connection's threshold at the server default", async () => {
    await searchTracks(projectId, BULK_MATCH_TITLE, 8);

    const shown = await db.execute<{ pg_trgm_similarity_threshold: string }>(
      sql`show pg_trgm.similarity_threshold`
    );

    // `set_config(..., true)` is transaction-local; a leak would show the
    // search floor here instead of Postgres' own default.
    expect(Number(Object.values(shown.rows[0]!)[0])).toBe(0.3);
  });
});
