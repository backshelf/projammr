import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { db } from "../index.js";
import {
  type NewRejection,
  type Rejections,
  type WrittenRejections,
  renderRejections,
} from "../schema/machine-rejections.js";
import { machines } from "../schema/machines.js";

/** The most bind parameters one rejection takes in its insert. */
const BINDS_PER_REJECTION = 5;

/** The caller's "Not a bounce" files, oldest first. */
export async function listNotABounce(
  userId: string
): Promise<Rejections["notABounce"]> {
  const rows = await db
    .select({
      id: renderRejections.id,
      fingerprint: renderRejections.fingerprint,
      fileName: renderRejections.fileName,
      createdAt: renderRejections.createdAt,
    })
    .from(renderRejections)
    .where(
      and(
        eq(renderRejections.userId, userId),
        eq(renderRejections.kind, "not-a-bounce")
      )
    )
    .orderBy(asc(renderRejections.createdAt), asc(renderRejections.id));
  // The kind's check constraint keeps a row's fields of its kind set.
  return rows.map((row) => ({ ...row, fingerprint: row.fingerprint! }));
}

/** The caller's rejections of both kinds, oldest first. A removed machine's folders are not listed. */
export async function listRejections(userId: string): Promise<Rejections> {
  const [notABounce, neverHere] = await Promise.all([
    listNotABounce(userId),
    db
      .select({
        id: renderRejections.id,
        machineId: renderRejections.machineId,
        folder: renderRejections.folder,
      })
      .from(renderRejections)
      .innerJoin(machines, eq(machines.id, renderRejections.machineId))
      .where(
        and(
          eq(renderRejections.userId, userId),
          eq(renderRejections.kind, "never-here"),
          isNull(machines.removedAt)
        )
      )
      .orderBy(asc(renderRejections.createdAt), asc(renderRejections.id)),
  ]);
  return {
    notABounce,
    neverHere: neverHere.map((row) => ({
      ...row,
      machineId: row.machineId!,
      folder: row.folder!,
    })),
  };
}

/**
 * Refuses a write naming a machine the caller cannot add a folder to: another
 * account's is a 403, one that does not exist or was removed a 404.
 */
async function assertOwnMachines(
  userId: string,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  const held = new Map(
    (
      await db
        .select({
          id: machines.id,
          userId: machines.userId,
          removedAt: machines.removedAt,
        })
        .from(machines)
        .where(inArray(machines.id, [...new Set(ids)]))
    ).map((row) => [row.id, row])
  );
  for (const id of ids) {
    const machine = held.get(id);
    if (machine && machine.userId !== userId) {
      throw new HTTPException(403, {
        message: "This machine belongs to another account",
      });
    }
    if (!machine || machine.removedAt !== null) {
      throw new HTTPException(404, { message: "Machine not found" });
    }
  }
}

/**
 * Writes the caller's rejections and answers the stored rows of those it
 * named, in the order named. A rejection
 * already held is kept as it was, bar a file name it lacked, so a write is safe
 * to repeat. A folder of a machine that is not the caller's refuses the whole
 * write.
 */
export async function writeRejections(
  userId: string,
  items: NewRejection[]
): Promise<WrittenRejections> {
  await assertOwnMachines(
    userId,
    items.flatMap((item) =>
      item.kind === "never-here" ? [item.machineId] : []
    )
  );

  // One statement cannot touch the same row twice, so a write naming one
  // rejection more than once records it once, under its first mention.
  const bounces = new Map<string, { fileName: string | null }>();
  const folders = new Map<string, { machineId: string; folder: string }>();
  for (const item of items) {
    if (item.kind === "not-a-bounce") {
      if (!bounces.has(item.fingerprint)) {
        bounces.set(item.fingerprint, { fileName: item.fileName ?? null });
      }
    } else {
      folders.set(JSON.stringify([item.machineId, item.folder]), item);
    }
  }

  const perStatement = Math.max(
    1,
    Math.floor((bindParamLimit() - 1) / BINDS_PER_REJECTION)
  );
  await db.transaction(async (tx) => {
    const bounceRows = [...bounces].map(([fingerprint, { fileName }]) => ({
      userId,
      kind: "not-a-bounce" as const,
      fingerprint,
      fileName,
    }));
    for (const batch of chunk(bounceRows, perStatement)) {
      await tx
        .insert(renderRejections)
        .values(batch)
        .onConflictDoUpdate({
          target: [renderRejections.userId, renderRejections.fingerprint],
          targetWhere: sql`${renderRejections.kind} = 'not-a-bounce'`,
          set: {
            fileName: sql`coalesce(${renderRejections.fileName}, excluded.file_name)`,
          },
        });
    }

    const folderRows = [...folders.values()].map(({ machineId, folder }) => ({
      userId,
      kind: "never-here" as const,
      machineId,
      folder,
    }));
    for (const batch of chunk(folderRows, perStatement)) {
      await tx
        .insert(renderRejections)
        .values(batch)
        .onConflictDoNothing({
          target: [renderRejections.machineId, renderRejections.folder],
          where: sql`${renderRejections.kind} = 'never-here'`,
        });
    }
  });

  const held = await listRejections(userId);
  const files = new Map(held.notABounce.map((row) => [row.fingerprint, row]));
  const places = new Map(
    held.neverHere.map((row) => [
      JSON.stringify([row.machineId, row.folder]),
      row,
    ])
  );
  const stored = new Map<string, WrittenRejections["items"][number]>();
  for (const item of items) {
    if (item.kind === "not-a-bounce") {
      const row = files.get(item.fingerprint)!;
      stored.set(JSON.stringify([item.kind, item.fingerprint]), {
        kind: item.kind,
        ...row,
      });
    } else {
      const row = places.get(JSON.stringify([item.machineId, item.folder]))!;
      stored.set(JSON.stringify([item.kind, item.machineId, item.folder]), {
        kind: item.kind,
        ...row,
      });
    }
  }
  return { items: [...stored.values()] };
}

/** Deletes one of the caller's rejections. Another account's, like none, is a 404. */
export async function deleteRejection(
  id: number,
  userId: string
): Promise<void> {
  const removed = await db
    .delete(renderRejections)
    .where(
      and(eq(renderRejections.id, id), eq(renderRejections.userId, userId))
    )
    .returning({ id: renderRejections.id });
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Rejection not found" });
  }
}

/** The "Never here" folders of each of these machines, by machine id. */
export async function neverHereByMachine(
  machineIds: readonly string[]
): Promise<Map<string, { id: number; folder: string }[]>> {
  const byMachine = new Map<string, { id: number; folder: string }[]>();
  if (machineIds.length === 0) return byMachine;
  const rows = await db
    .select({
      id: renderRejections.id,
      machineId: renderRejections.machineId,
      folder: renderRejections.folder,
    })
    .from(renderRejections)
    .where(
      and(
        eq(renderRejections.kind, "never-here"),
        inArray(renderRejections.machineId, [...machineIds])
      )
    )
    .orderBy(asc(renderRejections.createdAt), asc(renderRejections.id));
  for (const row of rows) {
    const held = byMachine.get(row.machineId!) ?? [];
    held.push({ id: row.id, folder: row.folder! });
    byMachine.set(row.machineId!, held);
  }
  return byMachine;
}
