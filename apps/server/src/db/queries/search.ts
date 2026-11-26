import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { entityModules } from "../../entities/index.js";
import { sessionArchived } from "../../entities/session/queries.js";
import type { CommentTargetKind, EntityModule } from "../../entities/types.js";
import { db, type Tx } from "../index.js";
import { assets } from "../schema/assets.js";
import { collections } from "../schema/collections.js";
import { comments } from "../schema/comments.js";
import { sessions } from "../schema/sessions.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import {
  artworkJsonFromPath,
  artworkSchema,
  collectionImagePathSql,
  sessionImagePathSql,
  trackImagePathSql,
} from "./artwork.js";

/**
 * Below this trigram similarity, a match is noise rather than signal — a
 * one- or two-character query would otherwise return most of the project.
 * Starting point only; expected to be retuned once there's real data (see
 * task description).
 */
const SEARCH_FLOOR = 0.15;

/** Queries shorter than this short-circuit to no results rather than scanning every column. */
const MIN_QUERY_LENGTH = 2;

/** Rows returned per type, before the combined result set is trimmed to the caller's limit. */
const PER_TYPE_LIMIT = 8;

/**
 * How many rows a searcher fetches per row it returns.
 *
 * The prefix and recency boosts are folded in by `scoreRow`, which SQL knows
 * nothing about, so the SQL order is only an approximation of the final one.
 * Fetching a multiple of the limit leaves those boosts enough of the head to
 * reorder, without dragging the whole match set out of the database.
 */
const SQL_LIMIT_HEADROOM = 2;

const PREFIX_BOOST = 0.5;
const RECENCY_BOOST = 0.1;
/** Rows newer than this get some fraction of the recency boost; older rows get none. */
const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

/** Per-field weights: a hit on the primary name field outranks a body-field hit at equal similarity. */
const TITLE_WEIGHT = 1;
const BODY_WEIGHT = 0.4;
const IDENTIFIER_WEIGHT = 0.6;

/**
 * Runs a search statement with the similarity floor that the `%` operator
 * reads.
 *
 * `%` is the only form of this comparison `pg_trgm` can answer from a GIN
 * index — `similarity(col, q) > x` is a function call over an already-scanned
 * row — and it takes its threshold from a GUC rather than an argument.
 * `set_config`'s third argument makes the setting transaction-local, so a
 * pooled connection carries nothing back out to the next request. `SET LOCAL`
 * cannot be used in its place: Postgres does not accept a bind parameter there.
 */
function withSearchThreshold<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('pg_trgm.similarity_threshold', ${String(
        SEARCH_FLOOR
      )}, true)`
    );
    return run(tx);
  });
}

export const searchTypeSchema = z.enum([
  "track",
  "collection",
  "session",
  "asset",
]);
export type SearchType = z.infer<typeof searchTypeSchema>;

/** The limits a search caller is held to, shared by the REST route and the MCP tool. */
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
export const ALL_SEARCH_TYPES = searchTypeSchema.options;

export const searchResultSchema = z.object({
  type: searchTypeSchema,
  id: z.number(),
  title: z.string(),
  subtitle: z.string(),
  projectId: z.number(),
  matchedField: z.string(),
  snippet: z.string().optional(),
  /** Set when the match came from a comment on this entity, rather than the entity's own fields. */
  isComment: z.boolean().optional(),
  image: artworkSchema.nullable(),
  /** True for an archived track and for a session of one; false for every other result. */
  archived: z.boolean(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Live results before archived ones, each group by score. */
function liveThenScore(a: SearchResult, b: SearchResult): number {
  return Number(a.archived) - Number(b.archived) || b.score - a.score;
}

function recencyBonus(updatedAt: Date): number {
  const age = Date.now() - updatedAt.getTime();
  if (age <= 0) return RECENCY_BOOST;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return RECENCY_BOOST * (1 - age / RECENCY_WINDOW_MS);
}

function snippetOf(value: string | null, length = 140): string | undefined {
  if (!value) return undefined;
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/** Picks the highest-weighted field match and folds in the prefix/recency boosts. */
function scoreRow<Field extends string>(
  candidates: Array<{ field: Field; weighted: number; snippet: string | null }>,
  primaryField: string,
  primaryValue: string,
  q: string,
  updatedAt: Date
): { matchedField: Field; snippet: string | undefined; score: number } {
  const winner = candidates.reduce((best, c) =>
    c.weighted > best.weighted ? c : best
  );

  const isPrefixMatch = primaryValue.toLowerCase().startsWith(q.toLowerCase());
  const score =
    winner.weighted +
    (isPrefixMatch ? PREFIX_BOOST : 0) +
    recencyBonus(updatedAt);

  return {
    matchedField: winner.field,
    snippet: snippetOf(winner.snippet),
    score,
  };
}

/** The best weighted similarity across a track's columns — the SQL side of `scoreRow`. */
const trackMatchScore = (q: string) => sql<number>`greatest(
  similarity(${tracks.title}, ${q}) * ${TITLE_WEIGHT},
  similarity(${tracks.isrc}, ${q}) * ${IDENTIFIER_WEIGHT},
  similarity(${tracks.iswc}, ${q}) * ${IDENTIFIER_WEIGHT},
  similarity(${tracks.notesText}, ${q}) * ${BODY_WEIGHT}
)`;

export async function searchTracks(
  projectId: number,
  q: string,
  limit: number = PER_TYPE_LIMIT
): Promise<SearchResult[]> {
  const rows = await withSearchThreshold((tx) =>
    tx
      .select({
        id: tracks.id,
        title: tracks.title,
        isrc: tracks.isrc,
        iswc: tracks.iswc,
        notesText: tracks.notesText,
        updatedAt: tracks.updatedAt,
        archivedAt: tracks.archivedAt,
        projectId: tracks.projectId,
        simTitle: sql<number>`similarity(${tracks.title}, ${q})`,
        simIsrc: sql<number>`similarity(${tracks.isrc}, ${q})`,
        simIswc: sql<number>`similarity(${tracks.iswc}, ${q})`,
        simNotes: sql<number>`similarity(${tracks.notesText}, ${q})`,
        image: artworkJsonFromPath(
          trackImagePathSql(tracks.image, tracks.id, tracks.projectId)
        ),
      })
      .from(tracks)
      .where(
        and(
          eq(tracks.projectId, projectId),
          sql`(
            ${tracks.title} % ${q} or
            ${tracks.isrc} % ${q} or
            ${tracks.iswc} % ${q} or
            ${tracks.notesText} % ${q}
          )`
        )
      )
      .orderBy(desc(trackMatchScore(q)), desc(tracks.updatedAt))
      .limit(limit * SQL_LIMIT_HEADROOM)
  );

  return rows
    .map((row) => {
      const { matchedField, snippet, score } = scoreRow(
        [
          {
            field: "title",
            weighted: row.simTitle * TITLE_WEIGHT,
            snippet: row.title,
          },
          {
            field: "isrc",
            weighted: row.simIsrc * IDENTIFIER_WEIGHT,
            snippet: row.isrc,
          },
          {
            field: "iswc",
            weighted: row.simIswc * IDENTIFIER_WEIGHT,
            snippet: row.iswc,
          },
          {
            field: "notes",
            weighted: row.simNotes * BODY_WEIGHT,
            snippet: row.notesText,
          },
        ],
        "title",
        row.title,
        q,
        row.updatedAt
      );

      return {
        type: "track" as const,
        id: row.id,
        title: row.title,
        subtitle: row.isrc ?? "",
        projectId: row.projectId as number,
        matchedField,
        snippet,
        image: row.image,
        archived: row.archivedAt != null,
        score,
      };
    })
    .sort(liveThenScore)
    .slice(0, limit);
}

/** @see trackMatchScore */
const collectionMatchScore = (q: string) => sql<number>`greatest(
  similarity(${collections.title}, ${q}) * ${TITLE_WEIGHT},
  similarity(${collections.upc}, ${q}) * ${IDENTIFIER_WEIGHT},
  similarity(${collections.notesText}, ${q}) * ${BODY_WEIGHT}
)`;

async function searchCollections(
  projectId: number,
  q: string,
  limit: number = PER_TYPE_LIMIT
): Promise<SearchResult[]> {
  const rows = await withSearchThreshold((tx) =>
    tx
      .select({
        id: collections.id,
        title: collections.title,
        upc: collections.upc,
        notesText: collections.notesText,
        updatedAt: collections.updatedAt,
        projectId: collections.projectId,
        simTitle: sql<number>`similarity(${collections.title}, ${q})`,
        simUpc: sql<number>`similarity(${collections.upc}, ${q})`,
        simNotes: sql<number>`similarity(${collections.notesText}, ${q})`,
        image: artworkJsonFromPath(
          collectionImagePathSql(collections.image, collections.projectId)
        ),
      })
      .from(collections)
      .where(
        and(
          eq(collections.projectId, projectId),
          sql`(
            ${collections.title} % ${q} or
            ${collections.upc} % ${q} or
            ${collections.notesText} % ${q}
          )`
        )
      )
      .orderBy(desc(collectionMatchScore(q)), desc(collections.updatedAt))
      .limit(limit * SQL_LIMIT_HEADROOM)
  );

  return rows
    .map((row) => {
      const { matchedField, snippet, score } = scoreRow(
        [
          {
            field: "title",
            weighted: row.simTitle * TITLE_WEIGHT,
            snippet: row.title,
          },
          {
            field: "upc",
            weighted: row.simUpc * IDENTIFIER_WEIGHT,
            snippet: row.upc,
          },
          {
            field: "notes",
            weighted: row.simNotes * BODY_WEIGHT,
            snippet: row.notesText,
          },
        ],
        "title",
        row.title,
        q,
        row.updatedAt
      );

      return {
        type: "collection" as const,
        id: row.id,
        title: row.title,
        subtitle: row.upc ?? "",
        projectId: row.projectId as number,
        matchedField,
        snippet,
        image: row.image,
        archived: false,
        score,
      };
    })
    .sort(liveThenScore)
    .slice(0, limit);
}

/** @see trackMatchScore */
const sessionMatchScore = (q: string) => sql<number>`greatest(
  similarity(${sessions.name}, ${q}) * ${TITLE_WEIGHT},
  similarity(${sessions.localFilepath}, ${q}) * ${IDENTIFIER_WEIGHT},
  similarity(${sessions.notesText}, ${q}) * ${BODY_WEIGHT}
)`;

async function searchSessions(
  projectId: number,
  q: string,
  limit: number = PER_TYPE_LIMIT
): Promise<SearchResult[]> {
  const rows = await withSearchThreshold((tx) =>
    tx
      .select({
        id: sessions.id,
        name: sessions.name,
        localFilepath: sessions.localFilepath,
        notesText: sessions.notesText,
        updatedAt: sessions.updatedAt,
        archived: sessionArchived,
        projectId: sessions.projectId,
        simName: sql<number>`similarity(${sessions.name}, ${q})`,
        simFilepath: sql<number>`similarity(${sessions.localFilepath}, ${q})`,
        simNotes: sql<number>`similarity(${sessions.notesText}, ${q})`,
        image: artworkJsonFromPath(
          sessionImagePathSql(sessions.trackId, sessions.projectId)
        ),
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, projectId),
          sql`(
            ${sessions.name} % ${q} or
            ${sessions.localFilepath} % ${q} or
            ${sessions.notesText} % ${q}
          )`
        )
      )
      .orderBy(desc(sessionMatchScore(q)), desc(sessions.updatedAt))
      .limit(limit * SQL_LIMIT_HEADROOM)
  );

  return rows
    .map((row) => {
      const { matchedField, snippet, score } = scoreRow(
        [
          {
            field: "name",
            weighted: row.simName * TITLE_WEIGHT,
            snippet: row.name,
          },
          {
            field: "localFilepath",
            weighted: row.simFilepath * IDENTIFIER_WEIGHT,
            snippet: row.localFilepath,
          },
          {
            field: "notes",
            weighted: row.simNotes * BODY_WEIGHT,
            snippet: row.notesText,
          },
        ],
        "name",
        row.name,
        q,
        row.updatedAt
      );

      return {
        type: "session" as const,
        id: row.id,
        title: row.name,
        subtitle: row.localFilepath ?? "",
        projectId: row.projectId as number,
        matchedField,
        snippet,
        image: row.image,
        archived: row.archived,
        score,
      };
    })
    .sort(liveThenScore)
    .slice(0, limit);
}

async function searchAssets(
  projectId: number,
  q: string,
  limit: number = PER_TYPE_LIMIT
): Promise<SearchResult[]> {
  const rows = await withSearchThreshold((tx) =>
    tx
      .select({
        id: assets.id,
        name: assets.name,
        type: assets.type,
        updatedAt: assets.updatedAt,
        projectId: assets.projectId,
        simName: sql<number>`similarity(${assets.name}, ${q})`,
      })
      .from(assets)
      .where(and(eq(assets.projectId, projectId), sql`${assets.name} % ${q}`))
      .orderBy(
        desc(sql`similarity(${assets.name}, ${q})`),
        desc(assets.updatedAt)
      )
      .limit(limit * SQL_LIMIT_HEADROOM)
  );

  return rows
    .map((row) => {
      const { matchedField, snippet, score } = scoreRow(
        [
          {
            field: "name",
            weighted: row.simName * TITLE_WEIGHT,
            snippet: row.name,
          },
        ],
        "name",
        row.name,
        q,
        row.updatedAt
      );

      return {
        type: "asset" as const,
        id: row.id,
        title: row.name,
        subtitle: row.type,
        projectId: row.projectId as number,
        matchedField,
        snippet,
        // Assets have no artwork chain of their own (resolveArtwork doesn't
        // cover this kind) — the row shows the grayscale fallback.
        image: null,
        archived: false,
        score,
      };
    })
    .sort(liveThenScore)
    .slice(0, limit);
}

/**
 * The entities a comment can surface as: every module that declares a cover
 * chain for the comment search. A project comment has no entity of another
 * kind to attach to, so its module declares none and it is excluded here and
 * from the query below.
 */
function commentParents(): (EntityModule & { commentSearchImagePath: SQL })[] {
  return entityModules().filter(
    (m): m is EntityModule & { commentSearchImagePath: SQL } =>
      m.commentSearchImagePath != null
  );
}

/** The columns naming and illustrating one parent kind, keyed by that kind. */
const titleKey = (kind: string) => `${kind}Title`;
const imageKey = (kind: string) => `${kind}Image`;

/**
 * The fixed columns of the comment search. The per-kind title and cover
 * columns are added from the registry, so the row type carries them as
 * `unknown` and each is read back through its own module.
 */
type CommentSearchRow = {
  targetType: CommentTargetKind;
  targetId: number;
  content: string;
  positionMs: number | null;
  updatedAt: Date;
  audioTrackId: number | null;
  simContent: number;
  trackArchivedAt: Date | null;
  sessionArchived: boolean;
} & Record<string, unknown>;

/**
 * A result here is *of* the entity the comment targets, not of the comment:
 * selecting it should land the user on the track/collection/session the comment
 * hangs off, which is what they actually searched for. `project` comments have
 * no entity of one of those three types to attach to, so they're excluded.
 *
 * The comment's own `projectId` scopes the search, so the joins are here only
 * to name and illustrate the parent. `track_audio` comments need a second hop
 * (trackAudios → tracks) to reach a title; everything else resolves in one
 * join. Every branch runs as a LEFT JOIN in a single query — resolving each
 * comment's parent one row at a time would be one query per result.
 */
export async function searchComments(
  projectId: number,
  q: string,
  limit: number = PER_TYPE_LIMIT
): Promise<SearchResult[]> {
  const parents = commentParents();

  const selection: Record<string, PgColumn | SQL> = {
    targetType: comments.targetType,
    targetId: comments.targetId,
    content: comments.content,
    positionMs: comments.positionMs,
    updatedAt: comments.updatedAt,
    audioTrackId: trackAudios.trackId,
    simContent: sql<number>`similarity(${comments.content}, ${q})`,
    trackArchivedAt: tracks.archivedAt,
    sessionArchived,
  };
  for (const m of parents) {
    selection[titleKey(m.kind)] = m.nameColumn;
    selection[imageKey(m.kind)] = artworkJsonFromPath(m.commentSearchImagePath);
  }

  const rows = (await withSearchThreshold((tx) => {
    let query = tx.select(selection).from(comments).$dynamic();
    for (const m of parents) {
      query = query.leftJoin(
        m.table,
        and(eq(comments.targetType, m.kind), eq(m.table.id, comments.targetId))
      );
    }
    return query
      .leftJoin(
        trackAudios,
        and(
          eq(comments.targetType, "track_audio"),
          eq(trackAudios.id, comments.targetId)
        )
      )
      .where(
        and(
          eq(comments.projectId, projectId),
          // A comment on a kind with no parent row to surface as can never
          // resolve, so it is dropped here rather than after the limit has
          // been spent on it.
          inArray(comments.targetType, [
            ...parents.map((m) => m.kind),
            "track_audio" as const,
          ]),
          sql`${comments.content} % ${q}`
        )
      )
      .orderBy(
        desc(sql`similarity(${comments.content}, ${q})`),
        desc(comments.updatedAt)
      )
      .limit(limit * SQL_LIMIT_HEADROOM);
    // The select is assembled from the registry, so its result type is only
    // as specific as the record it was built from; the fixed columns above
    // are what the mapping reads by name.
  })) as CommentSearchRow[];

  // track_audio comments resolve their parent track's title/id via a second
  // join (trackAudios.trackId -> tracks), fetched in one extra query rather
  // than a third self-join above.
  const audioTrackIds = [
    ...new Set(
      rows
        .filter((r) => r.targetType === "track_audio" && r.audioTrackId != null)
        .map((r) => r.audioTrackId as number)
    ),
  ];
  const audioTracks = audioTrackIds.length
    ? await db
        .select({
          id: tracks.id,
          title: tracks.title,
          archivedAt: tracks.archivedAt,
          image: artworkJsonFromPath(
            trackImagePathSql(tracks.image, tracks.id, tracks.projectId)
          ),
        })
        .from(tracks)
        .where(inArray(tracks.id, audioTrackIds))
    : [];
  const audioTrackById = new Map(audioTracks.map((t) => [t.id, t]));

  return rows
    .map((row): SearchResult | null => {
      let type: SearchType;
      let id: number;
      let title: string;
      let image: SearchResult["image"];
      let archived: boolean;

      if (row.targetType === "track_audio") {
        const parent =
          row.audioTrackId == null
            ? undefined
            : audioTrackById.get(row.audioTrackId);
        if (parent == null) return null;
        type = "track";
        id = parent.id;
        title = parent.title;
        image = parent.image;
        archived = parent.archivedAt != null;
      } else {
        const parent = parents.find((m) => m.kind === row.targetType);
        const name = parent && row[titleKey(parent.kind)];
        if (parent == null || name == null) return null;
        type = parent.kind as SearchType;
        id = row.targetId;
        title = String(name);
        image = (row[imageKey(parent.kind)] ?? null) as SearchResult["image"];
        archived =
          row.targetType === "track"
            ? row.trackArchivedAt != null
            : row.targetType === "session" && row.sessionArchived;
      }

      const score = row.simContent * BODY_WEIGHT + recencyBonus(row.updatedAt);

      const subtitle =
        row.positionMs != null ? formatTimecode(row.positionMs) : title;

      return {
        type,
        id,
        title,
        subtitle,
        projectId,
        matchedField: "comment",
        snippet: snippetOf(row.content),
        isComment: true,
        image,
        archived,
        score,
      } satisfies SearchResult;
    })
    .filter((row): row is SearchResult => row !== null)
    .sort(liveThenScore)
    .slice(0, limit);
}

/** mm:ss (or h:mm:ss past an hour) — matches the client's formatTimecode in src/lib/utils.ts. */
function formatTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

const SEARCHERS: Record<
  SearchType,
  (projectId: number, q: string, limit?: number) => Promise<SearchResult[]>
> = {
  track: searchTracks,
  collection: searchCollections,
  session: searchSessions,
  asset: searchAssets,
};

/** Comment matches surface as their parent entity, so they only apply when that parent type is requested. */
const commentParentTypes = (): string[] => commentParents().map((m) => m.kind);

/**
 * Runs the requested per-type searches in parallel, merges their (already
 * per-type-capped) results, and trims to the caller's overall limit. The cap
 * happens inside each searcher so a project with hundreds of matching
 * sessions can't bury a couple of matching tracks before the merge.
 *
 * Comment matches ride along as an extra source rather than a `types` entry
 * of their own: a comment result *is* its parent track/collection/session,
 * so it only runs when the caller has requested at least one of those types.
 */
export async function searchProject(
  projectId: number,
  q: string,
  types: SearchType[],
  limit: number
): Promise<SearchResult[]> {
  if (q.trim().length < MIN_QUERY_LENGTH) return [];

  const searches = types.map((type) => SEARCHERS[type](projectId, q));
  const parentTypes = commentParentTypes();
  if (types.some((type) => parentTypes.includes(type))) {
    searches.push(searchComments(projectId, q));
  }

  const results = await Promise.all(searches);

  return results.flat().sort(liveThenScore).slice(0, limit);
}
