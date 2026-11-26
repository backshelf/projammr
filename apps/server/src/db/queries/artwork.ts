import { type Column, type SQL, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { images } from "../schema/images.js";
import { projects } from "../schema/projects.js";
import { tracks } from "../schema/tracks.js";

/**
 * The cover a page tints itself from: the file to show, and the accent bin the
 * palette extractor stored for it. A null `accentHue` means the cover had no
 * usable chroma, so the page stays grayscale.
 *
 * The hue/chroma pair is sent rather than finished colours because the client
 * emits a light and a dark variant of each and only CSS knows which is active.
 */
export const artworkSchema = z.object({
  assetPath: z.string(),
  accentHue: z.number().nullable(),
  accentChroma: z.number().nullable(),
});

export type Artwork = z.infer<typeof artworkSchema>;

/** Adds the resolved cover to an entity read's response shape. */
export function withArtwork<T extends z.ZodObject>(schema: T) {
  return schema.extend({ artwork: artworkSchema.nullable() });
}

/** An entity's covers in fallback order, nearest first. */
type ArtworkChain = (string | null | undefined)[];

/**
 * Resolves a chain per entity, in one query for all of them: the first cover in
 * the chain that has an `images` row wins, and an entity whose whole hierarchy
 * is coverless resolves to null.
 *
 * An `image` column holds the same key its `images` row is stored under, so the
 * match is a plain equality the `image_path` index can answer.
 */
export async function resolveArtworkChains(
  chains: ArtworkChain[]
): Promise<(Artwork | null)[]> {
  const keys = [...new Set(chains.flat().filter((p) => p != null))];
  if (keys.length === 0) return chains.map(() => null);

  const rows = await db
    .select({
      assetPath: images.assetPath,
      accentHue: images.accentHue,
      accentChroma: images.accentChroma,
    })
    .from(images)
    .where(inArray(images.assetPath, keys));

  const byKey = new Map(rows.map((artwork) => [artwork.assetPath, artwork]));

  return chains.map((chain) => {
    for (const path of chain) {
      const found = path ? byKey.get(path) : undefined;
      if (found) return found;
    }
    return null;
  });
}

async function resolveArtworkChain(chain: ArtworkChain) {
  const [artwork] = await resolveArtworkChains([chain]);
  return artwork ?? null;
}

/** Project covers — the last fallback in every chain — keyed by project id. */
async function projectImagePaths(projectIds: (number | null)[]) {
  const ids = [...new Set(projectIds.filter((id) => id != null))];
  if (ids.length === 0) return new Map<number, string | null>();

  const rows = await db
    .select({ id: projects.id, image: projects.image })
    .from(projects)
    .where(inArray(projects.id, ids));

  return new Map(rows.map((row) => [row.id, row.image]));
}

async function projectImagePath(projectId: number | null) {
  if (projectId == null) return null;
  return (await projectImagePaths([projectId])).get(projectId) ?? null;
}

export async function artworkForProject(project: { image: string | null }) {
  return resolveArtworkChain([project.image]);
}

export async function artworkForCollection(collection: {
  image: string | null;
  projectId: number | null;
}) {
  return resolveArtworkChain([
    collection.image,
    await projectImagePath(collection.projectId),
  ]);
}

/**
 * The release a track shows the cover of: its lowest-id collection, so a track
 * on several looks the same wherever it appears — the rule the SQL chain
 * below applies too.
 */
function coverCollection(
  collections: { id: number; image: string | null }[] | null | undefined
) {
  return [...(collections ?? [])].sort((a, b) => a.id - b.id)[0] ?? null;
}

type TrackArtworkSource = {
  image: string | null;
  projectId: number | null;
  collections?: { id: number; image: string | null }[] | null;
};

/**
 * The nearest cover for a set of tracks — own, then first collection's, then
 * project's — in two queries however many tracks there are.
 */
export async function artworkForTracks(
  tracks: TrackArtworkSource[]
): Promise<(Artwork | null)[]> {
  const byProject = await projectImagePaths(tracks.map((t) => t.projectId));

  return resolveArtworkChains(
    tracks.map((track) => [
      track.image,
      coverCollection(track.collections)?.image,
      track.projectId == null ? null : byProject.get(track.projectId),
    ])
  );
}

export async function artworkForTrack(track: TrackArtworkSource) {
  const [artwork] = await artworkForTracks([track]);
  return artwork ?? null;
}

/** A session has no cover of its own; it shows the one its track would. */
export async function artworkForSession(session: {
  projectId: number | null;
  track?: {
    image: string | null;
    collections?: { id: number; image: string | null }[] | null;
  } | null;
}) {
  return resolveArtworkChain([
    session.track?.image,
    coverCollection(session.track?.collections)?.image,
    await projectImagePath(session.projectId),
  ]);
}

/**
 * The nearest cover for every row of one project's listing, in two queries for
 * the whole page rather than a chain walk per row.
 */
export async function artworkForProjectRows(
  projectId: number,
  rows: { image: string | null }[]
): Promise<(Artwork | null)[]> {
  const fallback = await projectImagePath(projectId);
  return resolveArtworkChains(rows.map((row) => [row.image, fallback]));
}

/*
 * The same chains as SQL expressions, for the queries that resolve artwork
 * inside a larger statement rather than from rows already in hand — search
 * builds one union across every entity type and cannot walk the chain in JS.
 */

/** The artwork object (or null) for the first candidate path with an `images` row. */
export function artworkJsonFromPath(path: SQL | Column) {
  return sql<Artwork | null>`(
    select jsonb_build_object(
      'assetPath', ${images.assetPath},
      'accentHue', ${images.accentHue},
      'accentChroma', ${images.accentChroma}
    )
    from ${images}
    where ${images.assetPath} = ${path}
    limit 1
  )`;
}

function trackCoverCollectionImagePath(trackIdExpr: SQL | Column) {
  return sql`(
    select ${collections.image} from ${collectionTracks}
    join ${collections} on ${collections.id} = ${collectionTracks.collectionId}
    where ${collectionTracks.trackId} = ${trackIdExpr}
    order by ${collectionTracks.collectionId}
    limit 1
  )`;
}

export function trackImagePathSql(
  ownImageExpr: SQL | Column,
  trackIdExpr: SQL | Column,
  projectIdExpr: SQL | Column
) {
  return sql`coalesce(
    nullif(${ownImageExpr}, ''),
    ${trackCoverCollectionImagePath(trackIdExpr)},
    (select image from ${projects} where id = ${projectIdExpr})
  )`;
}

export function collectionImagePathSql(
  ownImageExpr: SQL | Column,
  projectIdExpr: SQL | Column
) {
  return sql`coalesce(
    nullif(${ownImageExpr}, ''),
    (select image from ${projects} where id = ${projectIdExpr})
  )`;
}

/** A session has no cover of its own; it shows its parent track's chain. */
export function sessionImagePathSql(
  trackIdExpr: SQL | Column,
  projectIdExpr: SQL | Column
) {
  return sql`coalesce(
    (select image from ${tracks} where id = ${trackIdExpr}),
    ${trackCoverCollectionImagePath(trackIdExpr)},
    (select image from ${projects} where id = ${projectIdExpr})
  )`;
}
