import {
  and,
  count,
  eq,
  inArray,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, type Tx } from "../index.js";
import { assets } from "../schema/assets.js";
import {
  collectionAttachments,
  sessionAttachments,
  trackAttachments,
} from "../schema/attachments.js";
import {
  type Collection,
  collections,
  collectionTracks,
} from "../schema/collections.js";
import { comments } from "../schema/comments.js";
import {
  CUSTOM_FIELD_KINDS,
  CUSTOM_FIELD_OWNERS,
  type CustomField,
  customFieldKindSchema,
  customFields,
  customFieldTypeSchema,
  customFieldValues,
} from "../schema/custom-fields.js";
import { entityLabels, labels } from "../schema/labels.js";
import { priorityLevels } from "../schema/priority-levels.js";
import { repos } from "../schema/repos.js";
import { bulkSelectionSchema } from "./pagination.js";
import { saves } from "../schema/saves.js";
import { sessionSamples } from "../schema/session-samples.js";
import { type Session, sessions } from "../schema/sessions.js";
import { statuses } from "../schema/statuses.js";
import { trackRelationTypes } from "../schema/track-relation-types.js";
import {
  type Track,
  trackAudios,
  trackRelations,
  tracks,
} from "../schema/tracks.js";
import { ENTITIES } from "../../entities/index.js";
import { recordActivity } from "./activity.js";
import { isMemberAtLeast, notInProject } from "./authorization.js";
import { fieldType } from "./custom-field-types.js";
import { getCustomFields } from "./custom-fields.js";
import { removeStoredFile } from "../../lib/storage.js";
import { projectScope, recomputeUsage } from "./storage-usage.js";
import {
  ensureRelationType,
  rethrowRelationTypeGone,
} from "./track-relation-types.js";
import type { LabelTarget } from "./labels.js";

/** The rows a move will carry into the target project, by kind. */
type MoveSet = {
  tracks: Set<number>;
  sessions: Set<number>;
  collections: Set<number>;
};

/** The entities a caller can ask to move. */
export type MovableKind = LabelTarget;

/** Body of the move routes: the project the entity is being moved into. */
export const moveEntitySchema = z.object({
  projectId: z.number().int().positive(),
});

/**
 * Body of `POST /bulk/move`: `projectId` is the source (what `authorizeProject`
 * gates), `selection` is resolved through the kind's own `list.selectIds`, and
 * `targetProjectId` is where the resolved rows go.
 */
export const bulkMoveSchema = z.object({
  projectId: z.coerce.number().int(),
  selection: bulkSelectionSchema,
  targetProjectId: z.number().int().positive(),
});

const emptyMoveSet = (): MoveSet => ({
  tracks: new Set(),
  sessions: new Set(),
  collections: new Set(),
});

function seedOf(kind: MovableKind, ids: number[]): MoveSet {
  const seed = emptyMoveSet();
  for (const id of ids) seed[`${kind}s`].add(id);
  return seed;
}

/**
 * An id set as a SQL array, tested with `= any` / `<> all`. Postgres rejects
 * `in ()` outright, and the usual workaround of a list holding null makes both
 * membership and its negation answer NULL, which a surrounding `not` then
 * swallows. An empty array answers false and true respectively, which is what
 * "belongs to nothing" and "belongs to none of these" actually mean.
 */
function idArray(ids: Iterable<number>): SQL {
  const values = [...ids];
  if (values.length === 0) return sql`array[]::int[]`;
  return sql`array[${sql.join(
    values.map((id) => sql`${id}`),
    sql`, `
  )}]::int[]`;
}

/** `column not in (ids)`, which every row satisfies when the set is empty. */
function notAmong(column: PgColumn, ids: number[]): SQL | undefined {
  return ids.length === 0 ? undefined : notInArray(column, ids);
}

/**
 * Closes `seed` under "exclusively owned by": a track's sessions always follow
 * it, and a collection brings the tracks no other collection in the source
 * project holds. The result is the full set of rows that change project.
 *
 * The set's tracks are locked `FOR NO KEY UPDATE` before their sessions are
 * read, and every session of the set is locked with that read, each in id
 * order. Every write that links a session to a track holds the track `FOR
 * SHARE` first (see `entities/session/queries.ts`), which that lock blocks, so
 * one that committed before the track lock is seen here and moves with the
 * track, and one that comes after waits for the move and then finds the track
 * gone from its project. The lock is no stronger: `FOR UPDATE` would also hold
 * up the `FOR KEY SHARE` of every child row's foreign-key check, and a write
 * that holds a value row the move later carries (a custom-field upsert) and
 * then inserts another would deadlock with it.
 *
 * The seeded collections are locked the same way first, then the tracks, then
 * the sessions, and each lock takes only the rows still in `sourceProjectId`,
 * so a move that queued behind another move of the same rows finds them gone
 * and answers the 404 a missing row gets, rather than moving them on from a
 * project it never checked.
 */
async function closeMoveSet(
  tx: Tx,
  sourceProjectId: number,
  seed: MoveSet
): Promise<MoveSet> {
  const set: MoveSet = {
    tracks: new Set(seed.tracks),
    sessions: new Set(seed.sessions),
    collections: new Set(seed.collections),
  };

  if (set.collections.size > 0) {
    const locked = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          inArray(collections.id, [...set.collections]),
          eq(collections.projectId, sourceProjectId)
        )
      )
      .orderBy(collections.id)
      .for("no key update");
    if (locked.length !== set.collections.size) {
      throw notInProject("Collection");
    }

    const moving = idArray(set.collections);
    const { rows } = await tx.execute<{ track_id: number }>(sql`
      select distinct ct.track_id as track_id
      from ${collectionTracks} ct
      where ct.collection_id = any(${moving})
        and not exists (
          select 1
          from ${collectionTracks} other
          join ${collections} c on c.id = other.collection_id
          where other.track_id = ct.track_id
            and c.project_id = ${sourceProjectId}
            and other.collection_id <> all(${moving})
        )`);
    for (const row of rows) set.tracks.add(Number(row.track_id));
  }

  if (set.tracks.size > 0) {
    const locked = await tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(
        and(
          inArray(tracks.id, [...set.tracks]),
          eq(tracks.projectId, sourceProjectId)
        )
      )
      .orderBy(tracks.id)
      .for("no key update");
    if (locked.length !== set.tracks.size) throw notInProject("Track");
  }

  if (set.tracks.size > 0 || set.sessions.size > 0) {
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        sql`${sessions.trackId} = any(${idArray(set.tracks)})
          or (${sessions.id} = any(${idArray(set.sessions)})
            and ${sessions.projectId} = ${sourceProjectId})`
      )
      .orderBy(sessions.id)
      .for("update");
    const locked = new Set(rows.map((row) => row.id));
    for (const id of seed.sessions) {
      if (!locked.has(id)) throw notInProject("Session");
    }
    for (const id of locked) set.sessions.add(id);
  }

  return set;
}

/**
 * Refuses a move whose closed set carries a session a dit repo holds. A repo
 * belongs to its project: the repo's routes, its commits and its storage
 * counter all resolve through it, so a session that left would still answer to
 * the old project's repo. The first such session by id is named.
 *
 * `closeMoveSet` locked the sessions before this reads `repo_id`, so an
 * adoption racing the move either committed already and is seen, or waits for
 * the move, whose project change `linkSession` then finds.
 */
async function assertNoRepoSessions(tx: Tx, set: MoveSet) {
  if (set.sessions.size === 0) return;
  const rows = await tx
    .select({ id: sessions.id, name: sessions.name, repoId: sessions.repoId })
    .from(sessions)
    .where(inArray(sessions.id, [...set.sessions]))
    .orderBy(sessions.id);
  const held = rows.find((row) => row.repoId != null);
  if (held) {
    const [repo] = await tx
      .select({ name: repos.name })
      .from(repos)
      .where(eq(repos.id, held.repoId!));
    throw new HTTPException(409, {
      message: `Session "${held.name}" is a dit set in repo "${repo!.name}"; a session in a repo can't move to another project.`,
    });
  }
}

/**
 * The assets nothing outside `set` reaches, and which therefore follow the move.
 * Every reference to an asset the source project still uses elsewhere — from
 * another entity, or from the project itself — leaves that asset behind.
 */
async function exclusiveAssets(
  tx: Tx,
  sourceProjectId: number,
  set: MoveSet
): Promise<number[]> {
  const movedTracks = idArray(set.tracks);
  const movedSessions = idArray(set.sessions);
  const movedCollections = idArray(set.collections);

  const { rows } = await tx.execute<{ asset_id: number }>(sql`
    with refs as (
      select asset_id, 'track' as kind, track_id as owner
        from track_attachments where asset_id is not null and track_id is not null
      union all select asset_id, 'track', track_id from track_audios
      union all select asset_id, 'session', session_id
        from session_attachments where asset_id is not null and session_id is not null
      union all select asset_id, 'collection', collection_id
        from collection_attachments where asset_id is not null and collection_id is not null
      union all select asset_id, 'project', project_id
        from project_attachments where asset_id is not null and project_id is not null
    ),
    moved as (
      select asset_id from refs
      where (kind = 'track' and owner = any(${movedTracks}))
         or (kind = 'session' and owner = any(${movedSessions}))
         or (kind = 'collection' and owner = any(${movedCollections}))
    ),
    shared as (
      select r.asset_id from refs r
      join ${assets} a on a.id = r.asset_id
      where a.project_id = ${sourceProjectId}
        and not ((r.kind = 'track' and r.owner = any(${movedTracks}))
              or (r.kind = 'session' and r.owner = any(${movedSessions}))
              or (r.kind = 'collection' and r.owner = any(${movedCollections})))
    )
    select distinct asset_id from moved
    where asset_id not in (select asset_id from shared)`);

  return rows.map((row) => Number(row.asset_id));
}

/**
 * Unlinks the moved rows from every asset staying behind, so a moved entity
 * keeps only the attachments that travel with it. Returns the spectrogram keys
 * of the track audios it dropped, for the caller to remove once the move
 * commits.
 */
async function dropSharedAttachments(
  tx: Tx,
  set: MoveSet,
  following: number[]
): Promise<string[]> {
  const trackIds = [...set.tracks];
  const sessionIds = [...set.sessions];
  const collectionIds = [...set.collections];
  const spectrogramKeys: string[] = [];

  if (trackIds.length > 0) {
    await tx
      .delete(trackAttachments)
      .where(
        and(
          inArray(trackAttachments.trackId, trackIds),
          notAmong(trackAttachments.assetId, following)
        )
      );
    const dropped = await tx
      .delete(trackAudios)
      .where(
        and(
          inArray(trackAudios.trackId, trackIds),
          notAmong(trackAudios.assetId, following)
        )
      )
      .returning({ spectrogramKey: trackAudios.spectrogramKey });
    spectrogramKeys.push(
      ...dropped.flatMap((row) =>
        row.spectrogramKey ? [row.spectrogramKey] : []
      )
    );
  }

  if (sessionIds.length > 0) {
    await tx
      .delete(sessionAttachments)
      .where(
        and(
          inArray(sessionAttachments.sessionId, sessionIds),
          notAmong(sessionAttachments.assetId, following)
        )
      );
  }

  if (collectionIds.length > 0) {
    await tx
      .delete(collectionAttachments)
      .where(
        and(
          inArray(collectionAttachments.collectionId, collectionIds),
          notAmong(collectionAttachments.assetId, following)
        )
      );
  }

  return spectrogramKeys;
}

/**
 * Drops the relations that would straddle the two projects. A relation between
 * two tracks that move together survives untouched.
 */
async function dropSplitRelations(tx: Tx, movedTracks: number[]) {
  if (movedTracks.length === 0) return;

  await tx
    .delete(trackRelations)
    .where(
      or(
        and(
          inArray(trackRelations.fromTrackId, movedTracks),
          notInArray(trackRelations.toTrackId, movedTracks)
        ),
        and(
          inArray(trackRelations.toTrackId, movedTracks),
          notInArray(trackRelations.fromTrackId, movedTracks)
        )
      )
    );
}

/**
 * Drops the collection memberships where only one side of the pair moves: a
 * moved track leaves the collections staying behind, and a moved collection
 * loses the tracks it shares with the ones it leaves.
 */
async function dropSplitMemberships(tx: Tx, set: MoveSet) {
  const trackIds = [...set.tracks];
  const collectionIds = [...set.collections];
  const split: (SQL | undefined)[] = [];

  if (trackIds.length > 0) {
    split.push(
      and(
        inArray(collectionTracks.trackId, trackIds),
        notAmong(collectionTracks.collectionId, collectionIds)
      )
    );
  }
  if (collectionIds.length > 0) {
    split.push(
      and(
        inArray(collectionTracks.collectionId, collectionIds),
        notAmong(collectionTracks.trackId, trackIds)
      )
    );
  }
  if (split.length === 0) return;

  await tx.delete(collectionTracks).where(or(...split));
}

/**
 * Re-points the rows at the target project's status of the same name, or clears
 * the column when it has none. Global statuses belong to no project and are
 * left where they are.
 */
async function remapStatuses(
  tx: Tx,
  table: PgTable,
  idColumn: PgColumn,
  statusColumn: PgColumn,
  ids: number[],
  sourceProjectId: number,
  targetProjectId: number
) {
  if (ids.length === 0) return;

  await tx.execute(sql`
    update ${table}
    set ${sql.raw(statusColumn.name)} = target_status.id
    from ${statuses} as source_status
    left join ${statuses} as target_status
      on target_status.project_id = ${targetProjectId}
      and target_status.name = source_status.name
    where ${idColumn} = any(${idArray(ids)})
      and ${statusColumn} = source_status.id
      and source_status.project_id = ${sourceProjectId}`);
}

/**
 * A priority level the target project's scale has no level of the same name
 * for, so the moved rows that held it (`count` of them, tracks, collections
 * and sessions together) took the target's default instead.
 */
const priorityFallbackSchema = z.object({
  from: z.string(),
  to: z.string(),
  count: z.number().int(),
});

type PriorityFallback = z.infer<typeof priorityFallbackSchema>;

/**
 * Re-points every moved row at the target project's level of the same name,
 * or at the target's default when its scale has none. A level is never left
 * behind: a target with no default fails the write outright rather than leave
 * a row pointing into the project it left. Answers the names that fell back.
 */
async function remapPriorities(
  tx: Tx,
  targetProjectId: number,
  set: MoveSet
): Promise<PriorityFallback[]> {
  const fellBack = new Map<string, number>();

  for (const [table, ids] of [
    [tracks, set.tracks],
    [collections, set.collections],
    [sessions, set.sessions],
  ] as const) {
    if (ids.size === 0) continue;

    const { rows } = await tx.execute<{ name: string; fell_back: boolean }>(sql`
      update ${table}
      set ${sql.identifier(table.priorityId.name)} = coalesce(
        target_level.id,
        (select fallback.id from ${priorityLevels} as fallback
          where fallback.project_id = ${targetProjectId} and fallback.is_default)
      )
      from ${priorityLevels} as source_level
      left join ${priorityLevels} as target_level
        on target_level.project_id = ${targetProjectId}
        and target_level.name = source_level.name
      where ${table.id} = any(${idArray(ids)})
        and ${table.priorityId} = source_level.id
      returning source_level.name as name, target_level.id is null as fell_back`);

    for (const row of rows) {
      if (row.fell_back) {
        fellBack.set(row.name, (fellBack.get(row.name) ?? 0) + 1);
      }
    }
  }
  if (fellBack.size === 0) return [];

  const [fallback] = await tx
    .select({ name: priorityLevels.name })
    .from(priorityLevels)
    .where(
      and(
        eq(priorityLevels.projectId, targetProjectId),
        eq(priorityLevels.isDefault, true)
      )
    );
  return [...fellBack]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, count]) => ({ from, to: fallback!.name, count }));
}

/**
 * Re-points the relations that move with their tracks at the target project's
 * type of the same name, adding that type after the target's last when it has
 * none: a relation cannot be left without a type, and a list has no default to
 * fall back on. Split relations are gone by now, so a relation from a moved
 * track has its other end moving too. The source's types are carried in their
 * own order, so the ones the target gains keep it.
 */
async function remapRelationTypes(
  tx: Tx,
  targetProjectId: number,
  movedTracks: number[]
): Promise<void> {
  if (movedTracks.length === 0) return;

  const carried = await tx
    .selectDistinct({
      id: trackRelationTypes.id,
      name: trackRelationTypes.name,
      rank: trackRelationTypes.rank,
    })
    .from(trackRelations)
    .innerJoin(
      trackRelationTypes,
      eq(trackRelationTypes.id, trackRelations.relationTypeId)
    )
    .where(
      and(
        inArray(trackRelations.fromTrackId, movedTracks),
        ne(trackRelationTypes.projectId, targetProjectId)
      )
    )
    .orderBy(trackRelationTypes.rank, trackRelationTypes.id);

  for (const type of carried) {
    const targetId = await ensureRelationType(tx, targetProjectId, type.name);
    await tx
      .update(trackRelations)
      .set({ relationTypeId: targetId })
      .where(
        and(
          eq(trackRelations.relationTypeId, type.id),
          inArray(trackRelations.fromTrackId, movedTracks)
        )
      )
      .catch(rethrowRelationTypeGone);
  }
}

/**
 * The target project's label of this name, created with the source colour when
 * the target has none.
 */
async function targetLabelId(
  tx: Tx,
  targetProjectId: number,
  label: { name: string; colourHex: string }
): Promise<number> {
  const [existing] = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(eq(labels.projectId, targetProjectId), eq(labels.name, label.name))
    );
  if (existing) return existing.id;

  const [created] = await tx
    .insert(labels)
    .values({
      projectId: targetProjectId,
      name: label.name,
      colourHex: label.colourHex,
    })
    .returning({ id: labels.id });
  return created!.id;
}

/**
 * Re-points the moved rows' labels at the target project's vocabulary. Labels
 * are per project and matched by name: the target's label of that name is
 * reused if it has one, and created with the same colour if not.
 */
async function remapLabels(
  tx: Tx,
  sourceProjectId: number,
  targetProjectId: number,
  set: MoveSet
) {
  for (const [entityType, ids] of [
    ["track", set.tracks],
    ["collection", set.collections],
    ["session", set.sessions],
  ] as const) {
    const entityIds = [...ids];
    if (entityIds.length === 0) continue;

    const rows = await tx
      .select({
        id: labels.id,
        name: labels.name,
        colourHex: labels.colourHex,
      })
      .from(entityLabels)
      .innerJoin(labels, eq(entityLabels.labelId, labels.id))
      .where(
        and(
          eq(entityLabels.entityType, entityType),
          inArray(entityLabels.entityId, entityIds),
          eq(labels.projectId, sourceProjectId)
        )
      );

    const sourceLabels = new Map(rows.map((row) => [row.id, row]));

    for (const label of sourceLabels.values()) {
      const targetId = await targetLabelId(tx, targetProjectId, label);

      await tx
        .update(entityLabels)
        .set({ labelId: targetId })
        .where(
          and(
            eq(entityLabels.labelId, label.id),
            eq(entityLabels.entityType, entityType),
            inArray(entityLabels.entityId, entityIds)
          )
        );
    }
  }
}

/** A custom field some of whose values a move drops, and how many. */
const droppedFieldSchema = z.object({
  fieldId: z.number().int(),
  kind: customFieldKindSchema,
  name: z.string(),
  type: customFieldTypeSchema,
  count: z.number().int().describe("How many values the move drops"),
});

export type DroppedField = z.infer<typeof droppedFieldSchema>;

/** What a move reports beyond the rows it moved. */
export const moveReportSchema = z.object({
  droppedFields: z.array(droppedFieldSchema),
  priorityFallbacks: z.array(priorityFallbackSchema),
});

export type MoveReport = z.infer<typeof moveReportSchema>;

/** A moved row as the move routes answer it: the row, with the move's report. */
export function movedRowSchema<T extends z.ZodObject>(row: T) {
  return row.extend(moveReportSchema.shape);
}

/** The custom values the moved tracks and collections hold. */
function movedValues(set: MoveSet): SQL | undefined {
  const owned = CUSTOM_FIELD_KINDS.flatMap((kind) => {
    const ids = set[`${kind}s`];
    if (ids.size === 0) return [];
    const column = customFieldValues[CUSTOM_FIELD_OWNERS[kind].valueKey];
    return [sql`${column} = any(${idArray(ids)})`];
  });
  return owned.length > 0 ? or(...owned) : undefined;
}

/**
 * Where the moved rows' custom values land. Each source field with values
 * carries onto the target project's field of the same kind, name and type,
 * where there is one; `dropped` counts per source field the values that land
 * nowhere: all of them when the target has no such field, and those its type
 * cannot carry across (a select option the target field has no label for).
 * The move and its preview both read this, so they cannot disagree.
 */
async function planFieldRemap(
  tx: Tx,
  sourceProjectId: number,
  targetProjectId: number,
  set: MoveSet
): Promise<{
  carries: { from: CustomField; to: CustomField }[];
  dropped: DroppedField[];
}> {
  const moved = movedValues(set);
  if (!moved) return { carries: [], dropped: [] };

  const held = await tx
    .select({ fieldId: customFieldValues.fieldId, n: count() })
    .from(customFieldValues)
    .where(moved)
    .groupBy(customFieldValues.fieldId);
  if (held.length === 0) return { carries: [], dropped: [] };
  const counts = new Map(held.map((row) => [row.fieldId, row.n]));

  const sources = await getCustomFields(sourceProjectId, undefined, tx);
  const targets = await getCustomFields(targetProjectId, undefined, tx);
  const carries: { from: CustomField; to: CustomField }[] = [];
  const dropped: DroppedField[] = [];

  for (const from of sources) {
    const total = counts.get(from.id);
    if (!total) continue;
    const to = targets.find(
      (field) =>
        field.kind === from.kind &&
        field.name === from.name &&
        field.type === from.type
    );
    let lost = total;
    if (to) {
      carries.push({ from, to });
      const unit = fieldType(from);
      const carried = unit.carry(customFieldValues[unit.column], from, to);
      const [row] = await tx
        .select({ n: count() })
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.fieldId, from.id),
            moved,
            sql`${carried} is null`
          )
        );
      lost = row?.n ?? 0;
    }
    if (lost > 0) {
      dropped.push({
        fieldId: from.id,
        kind: from.kind,
        name: from.name,
        type: from.type,
        count: lost,
      });
    }
  }
  return { carries, dropped };
}

/**
 * Carries the moved rows' custom values onto the target project's fields as
 * {@link planFieldRemap} lays out, and deletes the rest: a value row may only
 * name a field of its entity's project. Answers what was dropped.
 */
async function remapCustomFieldValues(
  tx: Tx,
  sourceProjectId: number,
  targetProjectId: number,
  set: MoveSet
): Promise<DroppedField[]> {
  const moved = movedValues(set);
  if (!moved) return [];
  const { carries, dropped } = await planFieldRemap(
    tx,
    sourceProjectId,
    targetProjectId,
    set
  );

  for (const { from, to } of carries) {
    const unit = fieldType(from);
    const carried = unit.carry(customFieldValues[unit.column], from, to);
    await tx
      .update(customFieldValues)
      .set({ fieldId: to.id, [unit.column]: carried })
      .where(
        and(
          eq(customFieldValues.fieldId, from.id),
          moved,
          sql`${carried} is not null`
        )
      );
  }

  await tx
    .delete(customFieldValues)
    .where(
      and(
        moved,
        sql`${customFieldValues.fieldId} in (select ${customFields.id} from ${customFields} where ${customFields.projectId} = ${sourceProjectId})`
      )
    );
  return dropped;
}

/**
 * Carries the moved rows' comments across. `comments.project_id` is a
 * denormalised copy of the target's project, and a stale one would leave the
 * thread readable from the project the entity has left.
 */
async function rehomeComments(
  tx: Tx,
  targetProjectId: number,
  set: MoveSet
): Promise<void> {
  for (const [targetType, ids] of [
    ["track", set.tracks],
    ["collection", set.collections],
    ["session", set.sessions],
  ] as const) {
    if (ids.size === 0) continue;
    await tx
      .update(comments)
      .set({ projectId: targetProjectId })
      .where(
        and(
          eq(comments.targetType, targetType),
          inArray(comments.targetId, [...ids])
        )
      );
  }

  if (set.tracks.size === 0) return;

  const audios = await tx
    .select({ id: trackAudios.id })
    .from(trackAudios)
    .where(inArray(trackAudios.trackId, [...set.tracks]));
  if (audios.length === 0) return;

  await tx
    .update(comments)
    .set({ projectId: targetProjectId })
    .where(
      and(
        eq(comments.targetType, "track_audio"),
        inArray(
          comments.targetId,
          audios.map((audio) => audio.id)
        )
      )
    );
}

/**
 * A moved session keeps its track only when that track moves with it; otherwise
 * the link would reach across projects.
 */
async function unlinkStrandedSessions(tx: Tx, set: MoveSet) {
  if (set.sessions.size === 0) return;

  await tx
    .update(sessions)
    .set({ trackId: null })
    .where(
      and(
        inArray(sessions.id, [...set.sessions]),
        notAmong(sessions.trackId, [...set.tracks])
      )
    );
}

/**
 * Writes the new project onto every moved row. Assets first and collections
 * last, so nothing points at a row that has yet to arrive.
 */
async function rehome(
  tx: Tx,
  targetProjectId: number,
  followingAssets: number[],
  set: MoveSet
) {
  const scope = { projectId: targetProjectId };

  if (followingAssets.length > 0) {
    await tx
      .update(assets)
      .set(scope)
      .where(inArray(assets.id, followingAssets));
  }
  if (set.sessions.size > 0) {
    await tx
      .update(sessions)
      .set(scope)
      .where(inArray(sessions.id, [...set.sessions]));
    await tx
      .update(saves)
      .set(scope)
      .where(inArray(saves.sessionId, [...set.sessions]));
    await tx
      .update(sessionSamples)
      .set(scope)
      .where(inArray(sessionSamples.sessionId, [...set.sessions]));
  }
  if (set.tracks.size > 0) {
    await tx
      .update(tracks)
      .set(scope)
      .where(inArray(tracks.id, [...set.tracks]));
  }
  if (set.collections.size > 0) {
    await tx
      .update(collections)
      .set(scope)
      .where(inArray(collections.id, [...set.collections]));
  }
}

/**
 * Moves `seed` and everything it exclusively owns into the target project.
 * What the moved rows share with the source project is unlinked from them
 * instead of following: shared assets stay, so do tracks another collection
 * still holds, and relations with only one side moving are dropped.
 */
async function applyMove(
  tx: Tx,
  sourceProjectId: number,
  targetProjectId: number,
  seed: MoveSet
): Promise<MoveReport & { set: MoveSet; droppedSpectrogramKeys: string[] }> {
  const set = await closeMoveSet(tx, sourceProjectId, seed);
  await assertNoRepoSessions(tx, set);
  const followingAssets = await exclusiveAssets(tx, sourceProjectId, set);

  const droppedSpectrogramKeys = await dropSharedAttachments(
    tx,
    set,
    followingAssets
  );
  await dropSplitRelations(tx, [...set.tracks]);
  await dropSplitMemberships(tx, set);

  await remapStatuses(
    tx,
    tracks,
    tracks.id,
    tracks.statusId,
    [...set.tracks],
    sourceProjectId,
    targetProjectId
  );
  await remapStatuses(
    tx,
    collections,
    collections.id,
    collections.statusId,
    [...set.collections],
    sourceProjectId,
    targetProjectId
  );
  const priorityFallbacks = await remapPriorities(tx, targetProjectId, set);
  await remapRelationTypes(tx, targetProjectId, [...set.tracks]);

  await remapLabels(tx, sourceProjectId, targetProjectId, set);
  const droppedFields = await remapCustomFieldValues(
    tx,
    sourceProjectId,
    targetProjectId,
    set
  );
  await rehomeComments(tx, targetProjectId, set);
  await unlinkStrandedSessions(tx, set);
  await rehome(tx, targetProjectId, followingAssets, set);

  return { set, droppedSpectrogramKeys, droppedFields, priorityFallbacks };
}

/** The answer to a move preview. */
export const movePreviewSchema = z.object({
  droppedFields: z
    .array(droppedFieldSchema)
    .describe(
      "Per custom field, the values the move would drop: the target " +
        "project has no field of the same kind, name and type, or (a select) " +
        "no option of the same label. Empty when nothing is lost."
    ),
});

/**
 * The guards every move and move preview passes: the ids sit in the source
 * project, the caller is an editor in the target, and the target is another
 * project.
 */
async function assertMovable(
  kind: MovableKind,
  ids: number[],
  sourceProjectId: number,
  targetProjectId: number,
  actorId: string
) {
  await ENTITIES[kind].assertInProject(ids, sourceProjectId);

  if (!(await isMemberAtLeast(actorId, targetProjectId, "editor"))) {
    throw new HTTPException(403, { message: "Requires project role: editor" });
  }

  if (sourceProjectId === targetProjectId) {
    throw new HTTPException(400, {
      message: "Already in that project",
    });
  }
}

/**
 * Moves every id of one kind into `targetProjectId`, in one transaction. The
 * caller supplies `sourceProjectId` (the mount gates a single move against it;
 * the bulk route's own gate supplies it) and vouches that every id was drawn
 * from that project — this still checks, so a caller that got that wrong
 * gets the same 404 a missing row gets. The project arrived in is named by
 * the caller, so editor there is checked here: a caller who cannot see the
 * target and one who cannot write to it are answered the same way, so the
 * refusal says nothing about whether the project exists. Answers the ids with
 * the move's report.
 */
export async function moveEntities(
  kind: MovableKind,
  ids: number[],
  sourceProjectId: number,
  targetProjectId: number,
  actorId: string
): Promise<MoveReport & { ids: number[] }> {
  await assertMovable(kind, ids, sourceProjectId, targetProjectId, actorId);

  const { droppedSpectrogramKeys, droppedFields, priorityFallbacks } =
    await db.transaction((tx) =>
      applyMove(tx, sourceProjectId, targetProjectId, seedOf(kind, ids))
    );
  // The files go once the rows naming them are committed gone, as every other
  // stored-file cleanup does.
  for (const key of droppedSpectrogramKeys) await removeStoredFile(key);

  // Assets and spectrograms changed hands wholesale, so both projects' counters
  // are re-derived rather than each row's bytes being tracked across the move.
  await recomputeUsage([
    projectScope(sourceProjectId),
    projectScope(targetProjectId),
  ]);

  for (const id of ids) {
    const change = {
      entityType: kind,
      entityId: id,
      userId: actorId,
      action: "updated" as const,
      before: { projectId: sourceProjectId },
      after: { projectId: targetProjectId },
    };
    await recordActivity({ ...change, projectId: sourceProjectId });
    await recordActivity({ ...change, projectId: targetProjectId });
  }

  return { ids, droppedFields, priorityFallbacks };
}

/**
 * What moving `ids` would drop, without moving anything: the same guards as
 * {@link moveEntities}, the same closed move set and the same field plan, so
 * the preview names exactly what the move then drops.
 */
export async function previewMove(
  kind: MovableKind,
  ids: number[],
  sourceProjectId: number,
  targetProjectId: number,
  actorId: string
): Promise<DroppedField[]> {
  await assertMovable(kind, ids, sourceProjectId, targetProjectId, actorId);

  return db.transaction(async (tx) => {
    const set = await closeMoveSet(tx, sourceProjectId, seedOf(kind, ids));
    await assertNoRepoSessions(tx, set);
    return (await planFieldRemap(tx, sourceProjectId, targetProjectId, set))
      .dropped;
  });
}

/** The one-id call of {@link moveEntities}, its source resolved from the row itself. */
async function moveEntity(
  kind: MovableKind,
  id: number,
  targetProjectId: number,
  actorId: string
): Promise<MoveReport> {
  const sourceProjectId = await ENTITIES[kind].projectIdFor(id);
  if (sourceProjectId == null) throw new HTTPException(404);

  const { droppedFields, priorityFallbacks } = await moveEntities(
    kind,
    [id],
    sourceProjectId,
    targetProjectId,
    actorId
  );
  return { droppedFields, priorityFallbacks };
}

export async function moveTrackToProject(
  trackId: number,
  targetProjectId: number,
  actorId: string
): Promise<Track & MoveReport> {
  const report = await moveEntity("track", trackId, targetProjectId, actorId);
  const [row] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!row) throw new HTTPException(404);
  return { ...row, ...report };
}

export async function moveCollectionToProject(
  collectionId: number,
  targetProjectId: number,
  actorId: string
): Promise<Collection & MoveReport> {
  const report = await moveEntity(
    "collection",
    collectionId,
    targetProjectId,
    actorId
  );
  const [row] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!row) throw new HTTPException(404);
  return { ...row, ...report };
}

export async function moveSessionToProject(
  sessionId: number,
  targetProjectId: number,
  actorId: string
): Promise<Session & MoveReport> {
  const report = await moveEntity(
    "session",
    sessionId,
    targetProjectId,
    actorId
  );
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!row) throw new HTTPException(404);
  return { ...row, ...report };
}
