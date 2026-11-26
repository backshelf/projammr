import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { stat } from "node:fs/promises";
import {
  AUDIO_MIME_TYPES,
  convertAudio,
  isAudioName,
} from "../../lib/media.js";
import { groupBounces, preferredFirst } from "@workspace/media";
import type { AudioExtension } from "@workspace/settings/groups/instance-limits";
import { db, type Tx } from "../index.js";
import {
  type Asset,
  assetWithContextSchema,
  type assetFingerprintMatchSchema,
  assets,
  type NewAsset,
} from "../schema/assets.js";
import { sessionAttachments } from "../schema/attachments.js";
import { comments } from "../schema/comments.js";
import {
  removeStoredFile,
  staticUrl,
  storedFilePath,
} from "../../lib/storage.js";
import { users } from "../schema/auth.js";
import { images, type ImageScope } from "../schema/images.js";
import { type Job } from "../schema/jobs.js";
import {
  sharelinkSnapshotTrackAudios,
  sharelinks,
} from "../schema/sharelinks.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { entityModules } from "../../entities/index.js";
import type { EntityKind } from "../../entities/types.js";
import { MINUTE_MS } from "../../lib/duration.js";
import type { ProjectResolution } from "./authorization.js";
import { type DuplicateKeep, projectPolicy } from "./project-policy.js";
import {
  escapeLikeTerm,
  hydratePage,
  offsetOf,
  pageResponseSchema,
  parseSort,
} from "./pagination.js";
import {
  addUsage,
  assertStorageAllows,
  remainingAllowance,
  scopesOf,
  subtractUsage,
  type UsageScope,
} from "./storage-usage.js";
import {
  enqueueJob,
  findJob,
  labelsBySubject,
  registerJobHandler,
  type JobReporter,
} from "./jobs.js";
import {
  closeVersionGaps,
  lockDoomedVersions,
  setPrimaryWithin,
} from "./track-audios.js";

export type AssetFingerprintMatch = z.infer<typeof assetFingerprintMatchSchema>;

/**
 * Inserts an asset and counts its bytes against the project holding it and the
 * account that put it there, in one transaction: every path that stores asset
 * bytes — an upload, a conversion's output — goes through here, so the counter
 * cannot be left to a caller to remember.
 */
export async function createAsset(asset: NewAsset) {
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(assets).values(asset).returning();
    if (!result) throw new Error(`Failed to create asset: ${asset}`);

    await addUsage(
      tx,
      scopesOf({ projectId: result.projectId, userId: result.createdByUser }),
      result.size
    );

    return result;
  });
}

export async function getAsset(assetId: number) {
  const [result] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!result) throw new HTTPException(404);

  return result;
}

/** Resolver for `authorizeProject`: an asset carries its project id. */
export async function projectIdForAsset(
  assetId: number
): Promise<ProjectResolution> {
  if (Number.isNaN(assetId)) return null;
  const [row] = await db
    .select({ projectId: assets.projectId })
    .from(assets)
    .where(eq(assets.id, assetId));
  if (!row) return null;
  return row.projectId;
}

type AssetAttachment = {
  kind: EntityKind;
  id: number;
  title: string;
};

/**
 * Every place a project's assets are attached, keyed by asset id. Each entity
 * module names the joins an asset reaches it through — a track has two, since
 * an audio file arrives via `track_audios` rather than `track_attachments` —
 * so the pair (kind, id) is deduplicated after every source is read.
 */
async function attachmentsForAssets(assetIds: number[]) {
  const byAsset = new Map<number, AssetAttachment[]>();
  if (assetIds.length === 0) return byAsset;

  const sources = entityModules().flatMap((m) =>
    m.assetSources.map((join) => ({ module: m, join }))
  );

  const results = await Promise.all(
    sources.map(({ module, join }) =>
      db
        .select({
          assetId: join.assetColumn,
          id: module.table.id,
          title: module.nameColumn,
        })
        .from(join.table)
        .innerJoin(module.table, eq(module.table.id, join.entityColumn))
        .where(inArray(join.assetColumn, assetIds))
    )
  );

  for (const [index, rows] of results.entries()) {
    const kind = sources[index]!.module.kind;
    for (const row of rows) {
      const assetId = Number(row.assetId);
      if (!Number.isFinite(assetId)) continue;
      const id = Number(row.id);
      const existing = byAsset.get(assetId) ?? [];
      if (existing.some((a) => a.kind === kind && a.id === id)) continue;
      existing.push({ kind, id, title: String(row.title) });
      byAsset.set(assetId, existing);
    }
  }

  return byAsset;
}

/** An asset plus its uploader and attachment context, hydrated for one page of ids. */
async function hydrateAssetsWithContext(ids: number[]) {
  const rows = await db
    .select({
      asset: assets,
      uploadedBy: {
        id: users.id,
        name: users.name,
        image: users.image,
      },
    })
    .from(assets)
    .leftJoin(users, eq(users.id, assets.createdByUser))
    .where(inArray(assets.id, ids));

  const byAsset = await attachmentsForAssets(rows.map((row) => row.asset.id));

  return rows.map(({ asset, uploadedBy }) => ({
    ...asset,
    uploadedBy: uploadedBy?.id ? uploadedBy : null,
    attachments: byAsset.get(asset.id) ?? [],
  }));
}

/** The one page of a project's assets `GET /assets/project/:projectId` answers. */
export const projectAssetsPageSchema = pageResponseSchema(
  assetWithContextSchema
);

/** The columns a project's asset listing may be sorted by. */
const assetSortColumns = {
  id: assets.id,
  name: assets.name,
  size: assets.size,
  createdAt: assets.createdAt,
} as const;

export type AssetsPageQuery = {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
};

/**
 * A page of a project's assets, with the uploader and attachment context the
 * files table shows: who uploaded each one and what it is attached to.
 *
 * The id page and the count both read the bare `assets` table so the
 * uploader join — one row per asset, never more — never has to be counted
 * around; only the page's own ids are then hydrated with that join and with
 * `attachmentsForAssets`, so `rowCount` counts matching files, not the joined
 * rows a wider select would produce.
 */
export async function getAssetsInProjectWithContext(
  projectId: number,
  { page, pageSize, q, sort }: AssetsPageQuery
): Promise<z.infer<typeof projectAssetsPageSchema>> {
  const sortSpec = parseSort(sort, Object.keys(assetSortColumns));
  const orderColumn = sortSpec
    ? assetSortColumns[sortSpec.key as keyof typeof assetSortColumns]
    : assets.id;
  const dir = sortSpec?.desc ? desc : asc;

  const where = and(
    eq(assets.projectId, projectId),
    q ? ilike(assets.name, `%${escapeLikeTerm(q)}%`) : undefined
  );

  const [idRows, [total]] = await Promise.all([
    db
      .select({ id: assets.id })
      .from(assets)
      .where(where)
      .orderBy(dir(orderColumn), asc(assets.id))
      .limit(pageSize)
      .offset(offsetOf(page, pageSize)),
    db.select({ value: count() }).from(assets).where(where),
  ]);

  const rows = await hydratePage(
    idRows.map((row) => row.id),
    hydrateAssetsWithContext
  );

  return { rows, rowCount: total?.value ?? 0, page, pageSize };
}

/**
 * The assets in a project whose content matches one of `fingerprints`, with the
 * sessions each is already attached to. This is how the scanner asks whether a
 * file it found on disk is already on the server: a match means re-uploading
 * the bytes would only duplicate them, and the session ids say whether the
 * existing asset is already linked where it belongs.
 */
export async function findAssetsByFingerprint(
  projectId: number,
  fingerprints: string[]
): Promise<AssetFingerprintMatch[]> {
  if (fingerprints.length === 0) return [];

  const rows = await db
    .select({
      id: assets.id,
      name: assets.name,
      fingerprint: assets.fingerprint,
    })
    .from(assets)
    .where(
      and(
        eq(assets.projectId, projectId),
        inArray(assets.fingerprint, fingerprints)
      )
    );

  if (rows.length === 0) return [];

  const attachedSessions = await db
    .select({
      assetId: sessionAttachments.assetId,
      sessionId: sessionAttachments.sessionId,
    })
    .from(sessionAttachments)
    .where(
      inArray(
        sessionAttachments.assetId,
        rows.map((row) => row.id)
      )
    );

  const sessionsByAsset = new Map<number, number[]>();
  for (const { assetId, sessionId } of attachedSessions) {
    if (assetId == null || sessionId == null) continue;
    sessionsByAsset.set(assetId, [
      ...(sessionsByAsset.get(assetId) ?? []),
      sessionId,
    ]);
  }

  return rows.map((row) => ({
    fingerprint: row.fingerprint!,
    assetId: row.id,
    name: row.name,
    sessionIds: sessionsByAsset.get(row.id) ?? [],
  }));
}

export type StaticFileKind = "asset" | "image" | "analysis";

export type StaticFileRecord = {
  kind: StaticFileKind;
  id: number;
  name: string;
  type: string;
  size: number;
  assetPath: string;
  scope: ImageScope;
  projectId: number | null;
};

/**
 * Resolves a stored key (`images/<uuid>.png`) to the owning asset, image or
 * analysis row in a single round trip. Each kind's files live in their own
 * directory, so at most one side of the union matches, and each side is an
 * indexed equality on the column the key is stored in.
 *
 * The row is what makes a file readable: `scope` and `projectId` together tell
 * the static handler who may have it, so it gates the download without a second
 * lookup. Assets always belong to a project; only an image can be user- or
 * instance-scoped. An analysis file is its track's, gated the same way as an
 * asset.
 *
 * `kind`, `id` and `size` identify the bytes without reading them, which is
 * what the handler's `ETag` is built from; `kind` also decides whether a
 * resize is on offer. A spectrogram PNG has no upload row to carry its own
 * size, so it is `stat`ed once here — its key is never rewritten in place, a
 * fresh analysis always writes a new one, so the result never goes stale.
 */
export async function getStaticFileByKey(
  key: string
): Promise<StaticFileRecord | undefined> {
  const [result] = await unionAll(
    db
      .select({
        kind: sql<StaticFileKind>`'asset'`.as("kind"),
        id: assets.id,
        name: assets.name,
        type: assets.type,
        size: assets.size,
        assetPath: assets.assetPath,
        scope: sql<ImageScope>`'project'::image_scope`.as("scope"),
        // Widened to match the image branch, whose avatars carry no project.
        projectId: sql<number | null>`${assets.projectId}`.as("project_id"),
      })
      .from(assets)
      .where(eq(assets.assetPath, key)),
    db
      .select({
        kind: sql<StaticFileKind>`'image'`.as("kind"),
        id: images.id,
        name: images.name,
        type: images.type,
        size: images.size,
        assetPath: images.assetPath,
        scope: images.scope,
        projectId: images.projectId,
      })
      .from(images)
      .where(eq(images.assetPath, key)),
    db
      .select({
        kind: sql<StaticFileKind>`'analysis'`.as("kind"),
        id: trackAudios.id,
        name: sql<string>`'spectrogram.png'`.as("name"),
        type: sql<string>`'image/png'`.as("type"),
        // Filled in below, once the union has picked this branch.
        size: sql<number>`0`.as("size"),
        assetPath: sql<string>`${trackAudios.spectrogramKey}`.as("asset_path"),
        scope: sql<ImageScope>`'project'::image_scope`.as("scope"),
        projectId: tracks.projectId,
      })
      .from(trackAudios)
      .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
      .where(eq(trackAudios.spectrogramKey, key))
  ).limit(1);

  if (!result || result.kind !== "analysis") return result;

  const { size } = await stat(storedFilePath(result.assetPath));
  return { ...result, size };
}

const sumSpectrogramBytes = (versions: { spectrogramBytes: number }[]) =>
  versions.reduce((sum, row) => sum + row.spectrogramBytes, 0);

export async function deleteAsset(id: number) {
  return db.transaction(async (tx) => {
    const versions = await lockDoomedVersions(tx, eq(assets.id, id));

    const [result] = await tx
      .delete(assets)
      .where(eq(assets.id, id))
      .returning();

    if (!result) throw new HTTPException(404);

    await closeVersionGaps(tx, versions);

    await subtractUsage(
      tx,
      scopesOf({ projectId: result.projectId, userId: result.createdByUser }),
      result.size
    );

    // The tiles cascaded away with the asset were counted against the project
    // alone, never the uploader.
    const tileBytes = sumSpectrogramBytes(versions);
    if (tileBytes > 0) {
      await subtractUsage(
        tx,
        scopesOf({ projectId: result.projectId }),
        tileBytes
      );
    }

    return result;
  });
}

/** What a bulk delete removed: the row count, and the files left to unlink. */
export type DeletedAssets = { deleted: number; storedKeys: string[] };

/**
 * Deletes the assets of `projectId` that `ids` names, and hands back every
 * stored file the caller must unlink once the transaction has committed: each
 * asset's own path, and the spectrogram of each track-audio row cascading away
 * with it.
 *
 * The `projectId` term is the whole authorization of `DELETE /assets/bulk`.
 * The mount proves the caller may edit that project and nothing proves the ids
 * belong to it, so an id naming a file in another project must not match here:
 * it is skipped, neither deleted nor counted. So is an id naming no row, and a
 * repeated id deletes its row once, since `in (...)` matches each row once.
 */
export async function deleteAssetsInProject(
  projectId: number,
  ids: number[]
): Promise<DeletedAssets> {
  if (ids.length === 0) return { deleted: 0, storedKeys: [] };
  return db.transaction((tx) => deleteAssetsWithin(tx, projectId, ids));
}

/** `deleteAssetsInProject` inside a transaction the caller already holds. */
async function deleteAssetsWithin(
  tx: Tx,
  projectId: number,
  ids: number[]
): Promise<DeletedAssets> {
  if (ids.length === 0) return { deleted: 0, storedKeys: [] };

  const doomed = and(eq(assets.projectId, projectId), inArray(assets.id, ids));

  // Read before the delete cascades the assets' track-audio rows away —
  // once they are gone, nothing else names the spectrogram PNGs they wrote,
  // or the versions whose gaps their tracks need closing.
  const versions = await lockDoomedVersions(tx, doomed);

  const removed = await tx.delete(assets).where(doomed).returning({
    assetPath: assets.assetPath,
    size: assets.size,
    createdByUser: assets.createdByUser,
    projectId: assets.projectId,
  });

  await closeVersionGaps(tx, versions);

  // Totalled per scope rather than per file: each `subtractUsage` is one
  // upsert, and Postgres refuses to touch a counter row twice in the same
  // statement, so the scopes a batch reaches have to be distinct.
  const owed = new Map<string, { scope: UsageScope; bytes: number }>();
  for (const row of removed) {
    const scopes = scopesOf({
      projectId: row.projectId,
      userId: row.createdByUser,
    });
    for (const scope of scopes) {
      const key = `${scope.kind}:${scope.id}`;
      const total = owed.get(key);
      if (total) total.bytes += row.size;
      else owed.set(key, { scope, bytes: row.size });
    }
  }

  // The cascaded spectrogram tiles count against the project alone, so they
  // join the project's entry rather than subtracting from it a second time.
  const tileBytes = sumSpectrogramBytes(versions);
  if (tileBytes > 0) {
    for (const scope of scopesOf({ projectId })) {
      const key = `${scope.kind}:${scope.id}`;
      const total = owed.get(key);
      if (total) total.bytes += tileBytes;
      else owed.set(key, { scope, bytes: tileBytes });
    }
  }
  for (const { scope, bytes } of owed.values()) {
    await subtractUsage(tx, [scope], bytes);
  }

  return {
    deleted: removed.length,
    storedKeys: [
      ...removed.map((row) => row.assetPath),
      ...versions.flatMap((row) =>
        row.spectrogramKey ? [row.spectrogramKey] : []
      ),
    ],
  };
}

/** One file of a duplicate group, as the audit lists it. */
const duplicateFileSchema = z.object({
  id: z.number(),
  name: z.string(),
  size: z.number(),
});

type DuplicateFile = z.infer<typeof duplicateFileSchema>;

/**
 * One bounce the scanner uploaded in several formats: the file kept, the
 * copies deleting would lose nothing with, and the copies that stay, each with
 * what it would take with it.
 */
const duplicateGroupSchema = z.object({
  kept: duplicateFileSchema,
  remove: z.array(duplicateFileSchema),
  skipped: z.array(
    duplicateFileSchema.extend({
      reason: z.enum(["in-use", "commented", "shared"]),
    })
  ),
});

export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;

type SkipReason = DuplicateGroup["skipped"][number]["reason"];

/** What `GET /assets/project/:projectId/duplicates` answers. */
export const duplicateGroupsSchema = z.object({
  groups: z.array(duplicateGroupSchema),
});

type BounceFile = DuplicateFile & {
  localFilepath: string;
  localFileMachineName: string;
  localFileUpdatedAt: Date;
};

const bounceFileOf = (file: BounceFile) => ({
  path: file.localFilepath,
  mtimeMs: file.localFileUpdatedAt.getTime(),
  size: file.size,
  machine: file.localFileMachineName,
});

/**
 * Groups the audio files into bounces of two or more (see `groupBounces`), each
 * with the file `keep` prefers first and the rest as its copies, by id.
 */
function bounceGroups(
  files: BounceFile[],
  windowMs: number,
  keep: DuplicateKeep
) {
  return groupBounces(
    files.filter((file) => isAudioName(file.localFilepath)),
    windowMs,
    bounceFileOf
  )
    .filter((run) => run.length > 1)
    .map((run) => {
      const [kept, ...copies] = run.sort(preferredFirst(keep, bounceFileOf));
      return { kept: kept!, copies: copies.sort((a, b) => a.id - b.id) };
    });
}

const listed = ({ id, name, size }: DuplicateFile): DuplicateFile => ({
  id,
  name,
  size,
});

/**
 * Why each copy would take something with it if deleted, or null when it
 * would not, for every `(copy, kept)` pair at once.
 *
 * A copy is in use when any join an entity module names reaches it at an
 * entity the same join does not reach the kept file at: a session, track,
 * collection or project it is attached to, or a track it is a version of.
 * Each join counts on its own, so a copy that is a track's version is in use
 * even when the kept file is only attached to that track. A copy is commented
 * when a comment targets one of its versions, and shared when a snapshot share
 * link pins one of them: deleting it would cascade that version off the share.
 */
async function reasonsToKeep(
  executor: Pick<typeof db, "execute">,
  pairs: { copyId: number; keptId: number }[]
) {
  const reasons = new Map<number, SkipReason | null>();
  if (pairs.length === 0) return reasons;

  const sources = entityModules().flatMap((m) => m.assetSources);
  const reach = sql.join(
    sources.map(
      (join, source) => sql`
        select ${source}::int as source,
          ${join.entityColumn} as entity_id,
          ${join.assetColumn} as asset_id
        from ${join.table}
        where ${join.assetColumn} in (
          select copy_id from pair union all select kept_id from pair
        )`
    ),
    sql` union all `
  );

  // Each pair binds two parameters, each source one, and the comment join's
  // target type one more; a whole library's copies can pass Postgres's limit
  // in one statement.
  const fixed = sources.length + 1;
  const size = Math.max(1, Math.floor((bindParamLimit() - fixed) / 2));
  for (const batch of chunk(pairs, size)) {
    const { rows } = await executor.execute<{
      id: number;
      reason: SkipReason | null;
    }>(sql`
      with pair (copy_id, kept_id) as (
        values ${sql.join(
          batch.map((pair) => sql`(${pair.copyId}::int, ${pair.keptId}::int)`),
          sql`, `
        )}
      ),
      reach as (${reach})
      select pair.copy_id as id,
        case
          when exists (
            select 1 from reach copy_reach
            where copy_reach.asset_id = pair.copy_id
              and not exists (
                select 1 from reach kept_reach
                where kept_reach.asset_id = pair.kept_id
                  and kept_reach.source = copy_reach.source
                  and kept_reach.entity_id = copy_reach.entity_id
              )
          ) then 'in-use'
          when exists (
            select 1 from ${trackAudios}
            join ${comments}
              on ${comments.targetId} = ${trackAudios.id}
              and ${eq(comments.targetType, "track_audio")}
            where ${trackAudios.assetId} = pair.copy_id
          ) then 'commented'
          when exists (
            select 1 from ${trackAudios}
            join ${sharelinkSnapshotTrackAudios}
              on ${sharelinkSnapshotTrackAudios.trackAudioId} = ${trackAudios.id}
            join ${sharelinks}
              on ${sharelinks.id} = ${sharelinkSnapshotTrackAudios.sharelinkId}
              and ${sharelinks.revokedAt} is null
            where ${trackAudios.assetId} = pair.copy_id
          ) then 'shared'
        end as reason
      from pair
    `);
    for (const row of rows) reasons.set(row.id, row.reason);
  }
  return reasons;
}

/**
 * The project's uploaded audio exported more than once from one
 * bounce (`Song.wav` beside `Song.mp3`), grouped by `bounceGroups` within the
 * project's same-bounce window, with the file its keep rule prefers kept and
 * every other one sorted into `remove` or, when `reasonsToKeep` finds it
 * would take something with it, `skipped`. A group whose copies are all
 * skipped is still listed, so the audit can say why. A web upload has no
 * `localFilepath` and is never grouped.
 */
export async function findDuplicateAudio(
  projectId: number,
  executor: Pick<typeof db, "select" | "execute"> = db
): Promise<DuplicateGroup[]> {
  const { audio } = await projectPolicy(projectId);
  const rows = await executor
    .select({
      id: assets.id,
      name: assets.name,
      size: assets.size,
      localFilepath: assets.localFilepath,
      localFileMachineName: assets.localFileMachineName,
      localFileUpdatedAt: assets.localFileUpdatedAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.projectId, projectId),
        isNotNull(assets.localFilepath),
        isNotNull(assets.localFileMachineName),
        isNotNull(assets.localFileUpdatedAt)
      )
    )
    .orderBy(assets.id);

  const groups = bounceGroups(
    rows.flatMap(
      ({ localFilepath, localFileMachineName, localFileUpdatedAt, ...file }) =>
        localFilepath && localFileMachineName && localFileUpdatedAt
          ? [
              {
                ...file,
                localFilepath,
                localFileMachineName,
                localFileUpdatedAt,
              },
            ]
          : []
    ),
    audio.sameBounceWindowMinutes * MINUTE_MS,
    audio.duplicateKeep
  );

  const reasons = await reasonsToKeep(
    executor,
    groups.flatMap(({ kept, copies }) =>
      copies.map((copy) => ({ copyId: copy.id, keptId: kept.id }))
    )
  );

  return groups.map(({ kept, copies }) => ({
    kept: listed(kept),
    remove: copies.filter((copy) => !reasons.get(copy.id)).map(listed),
    skipped: copies.flatMap((copy) => {
      const reason = reasons.get(copy.id);
      return reason ? [{ ...listed(copy), reason }] : [];
    }),
  }));
}

/**
 * Makes each kept file its track's primary where a copy about to go holds it.
 * `reasonsToKeep` only lets a copy go when the kept file is a version of every
 * track the copy is, so the kept file always has a row there to take it.
 */
async function handOverPrimaries(tx: Tx, keptFor: Map<number, number>) {
  if (keptFor.size === 0) return;

  const versions = await tx
    .select({
      id: trackAudios.id,
      trackId: trackAudios.trackId,
      assetId: trackAudios.assetId,
      isPrimary: trackAudios.isPrimary,
    })
    .from(trackAudios)
    .where(
      inArray(trackAudios.assetId, [...keptFor.keys(), ...keptFor.values()])
    );

  for (const primary of versions) {
    const keptId = keptFor.get(primary.assetId);
    if (!primary.isPrimary || keptId == null) continue;
    const heir = versions.find(
      (row) => row.trackId === primary.trackId && row.assetId === keptId
    );
    if (heir) await setPrimaryWithin(tx, primary.trackId, heir.id);
  }
}

/**
 * Deletes the copies `ids` names that the duplicate audit of `projectId` lists
 * in `remove`, handing a removed copy's primary to the file kept in its place
 * first, and returns what `deleteAssetsInProject` returns for the caller to
 * unlink after the commit.
 *
 * The audit is run again inside the transaction that deletes, so a preview
 * that went stale cannot remove a file attached or commented on since: an id
 * the fresh audit no longer lists is skipped, neither deleted nor counted. So
 * is an id from another project, which no audit of this one can list.
 */
export async function removeDuplicateAudio(
  projectId: number,
  ids: number[]
): Promise<DeletedAssets> {
  const requested = new Set(ids);

  return db.transaction(async (tx) => {
    // Every lock the delete below takes is held before the audit reads, so
    // what the audit judges cannot change under it. Attaching a file inserts
    // a row whose foreign key share-locks the asset, and pinning a version to
    // a snapshot one that share-locks the version; a comment share-locks its
    // version itself (`CommentTarget.lockForComment`). Each racing this
    // removal waits for it and then fails on the deleted row, rather than
    // landing between the audit and the delete, unseen.
    await lockDoomedVersions(
      tx,
      and(eq(assets.projectId, projectId), inArray(assets.id, ids))
    );

    const keptFor = new Map<number, number>();
    for (const group of await findDuplicateAudio(projectId, tx)) {
      for (const copy of group.remove) {
        if (requested.has(copy.id)) keptFor.set(copy.id, group.kept.id);
      }
    }

    await handOverPrimaries(tx, keptFor);
    return deleteAssetsWithin(tx, projectId, [...keptFor.keys()]);
  });
}

/**
 * Transcodes an asset and stores the result as an asset of its own.
 *
 * The output is written under a fresh UUID, never a name derived from the
 * upload: the source name is a display label, and the row that carries it is
 * what makes the file readable (the static handler gates on the asset's
 * project and serves it under the asset's name). `report.progress` carries
 * the encode's real percent, and `report.signal` aborts the ffmpeg child when
 * the job is cancelled — including a cancel that lands before ffmpeg ever
 * spawns, so nothing is written for a job nobody wants anymore.
 *
 * A throw anywhere between writing the output and the row that names it
 * (the encode itself, `stat`, or `createAsset`) removes the file: without
 * that, a cancel or a failed encode leaves bytes under a UUID no row points
 * at, orphaned in storage forever.
 */
async function convertAssetToAsset(
  assetId: number,
  format: AudioExtension,
  kbps: number | null,
  createdBy: string | null,
  report: JobReporter
) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!row) throw new Error(`Asset ${assetId} no longer exists`);

  const assetPath = `assets/${crypto.randomUUID()}${format}`;
  const outputPath = storedFilePath(assetPath);
  const scopes = scopesOf({
    projectId: row.projectId,
    userId: createdBy ?? row.createdByUser,
  });
  const allowance = await remainingAllowance(scopes);
  const overrun = new AbortController();
  let outgrewAllowance = false;

  try {
    await convertAudio(
      storedFilePath(row.assetPath),
      outputPath,
      format,
      kbps ?? undefined,
      {
        // The encode is measured as it writes rather than once it finishes:
        // an output that will not fit is not worth producing in full, and the
        // bytes it has already written are removed with the rest below.
        onProgress: async (fraction) => {
          if (
            allowance != null &&
            (await writtenBytes(outputPath)) > allowance
          ) {
            outgrewAllowance = true;
            overrun.abort();
          }
          await report.progress(fraction);
        },
        signal: AbortSignal.any([report.signal, overrun.signal]),
      }
    );

    const stem = row.name.includes(".")
      ? row.name.slice(0, row.name.lastIndexOf("."))
      : row.name;
    // Only a bitrate-carrying encode names one; the lossless formats say nothing.
    const name =
      `${stem}${kbps == null ? "" : `-${kbps}kbps`}${format}`.replaceAll(
        " ",
        "-"
      );

    const { size } = await stat(storedFilePath(assetPath));

    return await createAsset({
      assetPath,
      name,
      size,
      type: AUDIO_MIME_TYPES[format],
      createdByUser: createdBy ?? row.createdByUser,
      projectId: row.projectId,
    });
  } catch (error) {
    await removeStoredFile(assetPath);
    // Rethrown as a plain failure rather than the abort it arrived as: the job
    // was stopped because it cannot be done here, which is a failure to report
    // and not the cancellation a user asked for.
    if (outgrewAllowance) {
      throw new Error(
        "Conversion output passed the storage allowance and was stopped",
        { cause: error }
      );
    }
    throw error;
  }
}

/** Bytes an in-flight encode has written so far; nothing, before it starts. */
async function writtenBytes(path: string): Promise<number> {
  return stat(path).then(
    (file) => file.size,
    () => 0
  );
}

/** A finished conversion is only reusable while its output asset still exists. */
async function conversionOutputSurvives(job: Job) {
  const assetId = job.result?.assetId;
  if (typeof assetId !== "number") return false;

  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId));

  return row !== undefined;
}

/**
 * Queues a transcode of `asset` into `format`, or hands back the job that is
 * already doing it — or has already done it. Re-encoding the same asset to the
 * same format only makes a second copy of the same bytes, so the work is done
 * once as long as its output is still around.
 */
export async function enqueueAssetConversion(
  asset: Asset,
  format: AudioExtension,
  kbps?: number,
  createdBy?: string
): Promise<Job> {
  if (asset.projectId == null) {
    throw new HTTPException(400, {
      message: "Only an asset in a project can be converted",
    });
  }

  // The output is not measurable before it exists, so the source's own size
  // stands in for it: an encode rarely outgrows what it was made from, and one
  // that does is stopped mid-run against the allowance left.
  await assertStorageAllows(
    scopesOf({ projectId: asset.projectId, userId: createdBy }),
    asset.size
  );

  // Only a lossy encode has a bitrate: the one asked for, or the project's
  // default, recorded on the job so it says what it will use. Recording
  // `null` for the lossless formats keeps a job's parameters honest, and
  // makes two requests that mean the same thing — one naming a bitrate, one
  // not — land on the same job.
  const bitrate =
    format === ".mp3"
      ? (kbps ?? (await projectPolicy(asset.projectId)).audio.mp3Kbps)
      : null;

  const existing = await findJob({
    kind: "convert",
    subjectId: asset.id,
    statuses: ["queued", "running", "done"],
    params: { format, kbps: bitrate },
  });
  if (
    existing &&
    (existing.status !== "done" || (await conversionOutputSurvives(existing)))
  ) {
    return existing;
  }

  return enqueueJob({
    projectId: asset.projectId,
    kind: "convert",
    subjectId: asset.id,
    createdBy,
    result: { format, kbps: bitrate },
  });
}

async function assetNames(ids: number[]): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(inArray(assets.id, ids));
  return new Map(rows.map((asset) => [asset.id, asset.name]));
}

// A conversion is only ever requested on demand — there is no persistent
// "not yet converted" state to look for — so `convert` registers no finder.
registerJobHandler(
  "convert",
  async (job, report) => {
    if (job.subjectId == null) throw new Error("job names no asset");

    const output = await convertAssetToAsset(
      job.subjectId,
      job.result?.format as AudioExtension,
      (job.result?.kbps as number | null) ?? null,
      job.createdBy,
      report
    );

    // The output is stored under a UUID, so its display name travels with the
    // URL rather than being read off it.
    return {
      assetId: output.id,
      name: output.name,
      url: staticUrl(output.assetPath),
    };
  },
  {
    label: "Converting",
    steps: [{ key: "encode", label: "Converting", weight: 1 }],
    subjectLabels: labelsBySubject(assetNames),
  }
);
