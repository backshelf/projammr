import { getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "bun:test";
import { db, type Tx } from "../../db/index.js";
import {
  defaultLevelId,
  seedPriorityLevels,
} from "../../db/queries/priority-levels.js";
import { seedRelationTypes } from "../../db/queries/track-relation-types.js";
import { priorityLevels } from "../../db/schema/priority-levels.js";
import { projects } from "../../db/schema/projects.js";
import { trackRelationTypes } from "../../db/schema/track-relation-types.js";
import { trackRelations, tracks } from "../../db/schema/tracks.js";
import { deleteProjectRow } from "./queries.js";

/**
 * Deleting a project cascades to its tracks, relation types and priority
 * levels through separate foreign keys, and Postgres fires those cascades in
 * trigger-name order, which follows OIDs compared as strings: the order differs
 * between databases. These tests force the order that runs the tracks' cascade
 * after the others, inside a transaction they roll back, so the outcome does
 * not depend on the OIDs the database under test happens to hold. They change
 * table definitions, so they run serially.
 */

const rollback = Symbol("rollback");

/** Runs `body` in a transaction and rolls it back, whatever the body did. */
async function inRolledBackTransaction(
  body: (tx: Tx) => Promise<void>
): Promise<void> {
  await db
    .transaction(async (tx) => {
      await body(tx);
      throw rollback;
    })
    .catch((error) => {
      if (error !== rollback) throw error;
    });
}

/**
 * The name of the trigger that cascades a delete of a `projects` row into
 * `table`. Postgres fires the cascades of one delete in this name's order.
 */
async function cascadeTriggerName(tx: Tx, table: PgTable): Promise<string> {
  const {
    rows: [row],
  } = await tx.execute<{ name: string }>(sql`
    select t.tgname as name
    from pg_trigger t
    join pg_constraint c on c.oid = t.tgconstraint
    where c.contype = 'f'
      and c.conrelid = ${getTableName(table)}::regclass
      and c.confrelid = 'projects'::regclass
      and t.tgrelid = 'projects'::regclass
      and t.tgfoid = '"RI_FKey_cascade_del"'::regproc
  `);
  if (!row) throw new Error(`${getTableName(table)} has no cascading key`);
  return row.name;
}

/** Drops and re-adds `table`'s key to `projects`, which gives its cascade trigger a fresh OID. */
async function recreateProjectKey(tx: Tx, table: PgTable): Promise<void> {
  const name = getTableName(table);
  const {
    rows: [key],
  } = await tx.execute<{ name: string; definition: string }>(sql`
    select conname as name, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where contype = 'f'
      and conrelid = ${name}::regclass
      and confrelid = 'projects'::regclass
  `);
  if (!key) throw new Error(`${name} has no key to projects`);
  await tx.execute(
    sql`alter table ${sql.identifier(name)} drop constraint ${sql.identifier(key.name)}`
  );
  await tx.execute(
    sql`alter table ${sql.identifier(name)} add constraint ${sql.identifier(key.name)} ${sql.raw(key.definition)}`
  );
}

/**
 * Re-creates the relation types', the priority levels' and then `tracks`' keys
 * to `projects`, so the three cascade triggers carry consecutive new OIDs with
 * tracks' the newest, and checks the order is the one forced. Re-creating only
 * tracks' key is not enough: once the cluster's OID counter gains a digit, the
 * new name sorts first as a string (`…_a_10049213` < `…_a_7560604`).
 */
async function fireTracksCascadeLast(tx: Tx): Promise<void> {
  for (const table of [trackRelationTypes, priorityLevels, tracks]) {
    await recreateProjectKey(tx, table);
  }

  const tracksLast = await cascadeTriggerName(tx, tracks);
  for (const other of [trackRelationTypes, priorityLevels]) {
    expect((await cascadeTriggerName(tx, other)) < tracksLast).toBe(true);
  }
}

async function seedTrack(tx: Tx, projectId: number): Promise<number> {
  const [track] = await tx
    .insert(tracks)
    .values({
      title: "Track",
      artists: [],
      projectId,
      priorityId: await defaultLevelId(projectId, tx),
    })
    .returning({ id: tracks.id });
  return track!.id;
}

/** How many rows of `table` the project still owns. */
async function rowsOf(tx: Tx, table: string, projectId: number) {
  const {
    rows: [row],
  } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from ${sql.identifier(table)}
    where project_id = ${projectId}
  `);
  return row!.n;
}

describe("deleting a project whose tracks' cascade fires after its other cascades", () => {
  it("deletes tracks on the project's priority levels that hold relations of its relation types", async () => {
    await inRolledBackTransaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ name: `Delete order ${Date.now()}` })
        .returning({ id: projects.id });
      const id = project!.id;
      await seedPriorityLevels(tx, id);
      await seedRelationTypes(tx, id);
      const from = await seedTrack(tx, id);
      const to = await seedTrack(tx, id);
      const [type] = await tx
        .select({ id: trackRelationTypes.id })
        .from(trackRelationTypes)
        .limit(1)
        .where(sql`${trackRelationTypes.projectId} = ${id}`);
      await tx.insert(trackRelations).values({
        fromTrackId: from,
        toTrackId: to,
        relationTypeId: type!.id,
      });
      await fireTracksCascadeLast(tx);

      const deleted = await deleteProjectRow(tx, id);

      expect(deleted.map((row) => row.id)).toEqual([id]);
      expect(await rowsOf(tx, "tracks", id)).toBe(0);
      expect(await rowsOf(tx, "priority_levels", id)).toBe(0);
      expect(await rowsOf(tx, "track_relation_types", id)).toBe(0);
    });
  });
});
