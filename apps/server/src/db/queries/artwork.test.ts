import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../index.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { images } from "../schema/images.js";
import { projects } from "../schema/projects.js";
import { tracks } from "../schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import {
  artworkForCollection,
  artworkForProject,
  artworkForTrack,
  resolveArtworkChains,
} from "./artwork.js";

/**
 * A cover is found by matching an entity's `image` column against the key its
 * `images` row is stored under. Both hold `images/<uuid>.<ext>` — the same
 * string — so the lookup is a plain equality rather than a `regexp_replace`
 * over the column, which is what made the `image_path` index unusable.
 */
const PROJECT_COVER = "images/artwork-test-project.png";
const COLLECTION_COVER = "images/artwork-test-collection.png";
const TRACK_COVER = "images/artwork-test-track.png";

let projectId: number;
let coveredTrackId: number;
let inheritingTrackId: number;
let bareTrackId: number;
let coveredCollectionId: number;

beforeAll(async () => {
  const [project] = await db
    .insert(projects)
    .values({ name: `Artwork Test ${Date.now()}`, image: PROJECT_COVER })
    .returning({ id: projects.id });
  projectId = project!.id;
  const priorityId = await seedScale(projectId);

  await db.insert(images).values([
    {
      assetPath: PROJECT_COVER,
      name: "project.png",
      type: "image/png",
      size: 1,
      projectId,
      accentHue: 120,
      accentChroma: 0.05,
    },
    {
      assetPath: COLLECTION_COVER,
      name: "collection.png",
      type: "image/png",
      size: 1,
      projectId,
      accentHue: 210,
      accentChroma: 0.1,
    },
    {
      assetPath: TRACK_COVER,
      name: "track.png",
      type: "image/png",
      size: 1,
      projectId,
      accentHue: 30,
      accentChroma: 0.15,
    },
  ]);

  const [collection] = await db
    .insert(collections)
    .values({
      title: "Artwork Collection",
      projectId,
      priorityId,
      image: COLLECTION_COVER,
    })
    .returning({ id: collections.id });
  coveredCollectionId = collection!.id;

  const [covered] = await db
    .insert(tracks)
    .values({
      title: "Own Cover",
      artists: [],
      projectId,
      priorityId,
      image: TRACK_COVER,
    })
    .returning({ id: tracks.id });
  coveredTrackId = covered!.id;

  const [inheriting] = await db
    .insert(tracks)
    .values({ title: "Collection Cover", artists: [], projectId, priorityId })
    .returning({ id: tracks.id });
  inheritingTrackId = inheriting!.id;
  await db
    .insert(collectionTracks)
    .values({ collectionId: coveredCollectionId, trackId: inheritingTrackId });

  const [bare] = await db
    .insert(tracks)
    .values({ title: "Project Cover Only", artists: [], projectId, priorityId })
    .returning({ id: tracks.id });
  bareTrackId = bare!.id;
});

afterAll(async () => {
  await db.delete(tracks).where(eq(tracks.projectId, projectId));
  await db.delete(collections).where(eq(collections.projectId, projectId));
  await db
    .delete(images)
    .where(
      inArray(images.assetPath, [PROJECT_COVER, COLLECTION_COVER, TRACK_COVER])
    );
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("resolveArtworkChains", () => {
  it("matches an entity's key against the images row it names", async () => {
    const [artwork] = await resolveArtworkChains([[TRACK_COVER]]);

    expect(artwork).toMatchObject({
      assetPath: TRACK_COVER,
      accentHue: 30,
      accentChroma: 0.15,
    });
  });

  it("takes the first link in the chain that has a row", async () => {
    const [artwork] = await resolveArtworkChains([
      ["images/nothing-here.png", COLLECTION_COVER, PROJECT_COVER],
    ]);

    expect(artwork?.assetPath).toBe(COLLECTION_COVER);
  });

  it("resolves to null when nothing in the chain has a row", async () => {
    const [artwork] = await resolveArtworkChains([
      ["images/nothing-here.png", null, undefined],
    ]);

    expect(artwork).toBeNull();
  });

  it("keeps one result per chain, in order", async () => {
    const resolved = await resolveArtworkChains([
      [TRACK_COVER],
      [null],
      [COLLECTION_COVER],
    ]);

    expect(resolved.map((a) => a?.assetPath ?? null)).toEqual([
      TRACK_COVER,
      null,
      COLLECTION_COVER,
    ]);
  });
});

describe("the fallback chain", () => {
  it("gives a track its own cover", async () => {
    const track = await db.query.tracks.findFirst({
      where: { id: coveredTrackId },
      with: { collections: true },
    });

    expect((await artworkForTrack(track!))?.assetPath).toBe(TRACK_COVER);
  });

  it("falls back to the track's first collection", async () => {
    const track = await db.query.tracks.findFirst({
      where: { id: inheritingTrackId },
      with: { collections: true },
    });

    expect((await artworkForTrack(track!))?.assetPath).toBe(COLLECTION_COVER);
  });

  it("falls back to the project", async () => {
    const track = await db.query.tracks.findFirst({
      where: { id: bareTrackId },
      with: { collections: true },
    });

    expect((await artworkForTrack(track!))?.assetPath).toBe(PROJECT_COVER);
  });

  it("gives a collection its own cover, and a project its own", async () => {
    const collection = await db.query.collections.findFirst({
      where: { id: coveredCollectionId },
    });
    const project = await db.query.projects.findFirst({
      where: { id: projectId },
    });

    expect((await artworkForCollection(collection!))?.assetPath).toBe(
      COLLECTION_COVER
    );
    expect((await artworkForProject(project!))?.assetPath).toBe(PROJECT_COVER);
  });
});
