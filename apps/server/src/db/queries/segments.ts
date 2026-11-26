import { sql } from "drizzle-orm";
import { z } from "zod";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { attributedTo, type PushMachine } from "../../lib/push-machine.js";
import { db, type Tx } from "../index.js";
import { rawSegmentSourceEnum } from "../schema/enums.js";
import { machineNameSchema } from "../schema/machines.js";
import { timeSegments } from "../schema/repos.js";
import { epochDate } from "../schema/sessions.js";
import { branchIdOf, branchNameSchema } from "./branches.js";

const pushedSegmentSchema = z
  .object({
    branch: branchNameSchema,
    machineName: machineNameSchema,
    startedAt: epochDate,
    endedAt: epochDate,
    source: z.enum(rawSegmentSourceEnum),
  })
  .refine((segment) => segment.endedAt >= segment.startedAt, {
    message: "endedAt must not be before startedAt",
    path: ["endedAt"],
  });

export const pushSegmentsBodySchema = z.object({
  ditSetId: z.string().trim().min(1),
  segments: z.array(pushedSegmentSchema).min(1).max(500),
});

export const segmentsPushedSchema = z.object({
  recorded: z.number().int(),
});

type PushedSegment = z.infer<typeof pushedSegmentSchema>;
type SegmentRow = typeof timeSegments.$inferInsert;

/** Bind parameters one segment row takes in the insert. */
const BINDS_PER_SEGMENT = 7;

/**
 * Records spans of time the set was open. A span pushed again keeps its start
 * and takes the later of its ends, so a re-push counts once. A span names the
 * pushing machine by id when it carries that machine's name.
 */
export async function recordSegments(input: {
  sessionId: number;
  machine: PushMachine;
  segments: PushedSegment[];
}): Promise<number> {
  const { sessionId, machine, segments } = input;
  await db.transaction(async (tx) => {
    const rows = await mergedRows(tx, sessionId, machine, segments);
    const perStatement = Math.max(
      1,
      Math.floor((bindParamLimit() - 1) / BINDS_PER_SEGMENT)
    );
    for (const batch of chunk(rows, perStatement)) {
      await tx
        .insert(timeSegments)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            timeSegments.sessionId,
            timeSegments.branchId,
            timeSegments.machineName,
            timeSegments.machineId,
            timeSegments.startedAt,
          ],
          set: {
            endedAt: sql`greatest(${timeSegments.endedAt}, excluded.ended_at)`,
            source: sql`case when excluded.ended_at >= ${timeSegments.endedAt} then excluded.source else ${timeSegments.source} end`,
            updatedAt: new Date(),
          },
        });
    }
  });
  return segments.length;
}

/**
 * The segments as rows, one per span. One insert cannot touch the same row
 * twice, so spans repeated within the body are folded here first, with the
 * same rule the upsert applies across pushes.
 */
async function mergedRows(
  tx: Tx,
  sessionId: number,
  machine: PushMachine,
  segments: PushedSegment[]
): Promise<SegmentRow[]> {
  const branchIds = new Map<string, number>();
  const merged = new Map<string, SegmentRow>();
  for (const segment of segments) {
    let branchId = branchIds.get(segment.branch);
    if (branchId === undefined) {
      branchId = await branchIdOf(tx, sessionId, segment.branch);
      branchIds.set(segment.branch, branchId);
    }
    const row: SegmentRow = {
      sessionId,
      branchId,
      machineName: segment.machineName,
      machineId: attributedTo(machine, segment.machineName),
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      source: segment.source,
    };
    const key = `${branchId}|${segment.machineName}|${segment.startedAt.getTime()}`;
    const existing = merged.get(key);
    if (!existing || row.endedAt >= existing.endedAt) merged.set(key, row);
  }
  return [...merged.values()];
}

/**
 * The seconds the set was open across the window each commit covers: the
 * union of its branch's segments, clipped to the window the commit's save
 * adds, from the parent's save file time (exclusive) to its own (inclusive).
 * A commit with no parent has no lower bound. A commit with no segment time
 * in its window is absent from the map, and so is one whose own save is not
 * newer than its parent's (a clock that stepped back), which has no window.
 */
export async function timeInSetCoveredBy(
  commitIds: number[]
): Promise<Map<number, number>> {
  if (commitIds.length === 0) return new Map();
  const ids = sql.join(
    commitIds.map((id) => sql`${id}`),
    sql`, `
  );
  const { rows } = await db.execute<{ commitId: number; seconds: number }>(sql`
    with spans as (
      select c.id as commit_id,
             unnest(range_agg(
               tsrange(s.started_at, s.ended_at)
               * tsrange(coalesce(ps.file_updated_at, '-infinity'), own.file_updated_at, '(]')
             )) as span
        from commits c
        join saves own on own.id = c.save_id
        left join commits p on p.id = c.parent_id
        left join saves ps on ps.id = p.save_id
        join time_segments s
          on s.branch_id = c.branch_id
         and s.started_at < own.file_updated_at
         and s.ended_at > coalesce(ps.file_updated_at, '-infinity')
         and own.file_updated_at > coalesce(ps.file_updated_at, '-infinity')
       where c.id in (${ids})
       group by c.id
    )
    select commit_id as "commitId",
           round(extract(epoch from sum(upper(span) - lower(span))))::float8 as seconds
      from spans
     group by commit_id
  `);
  return new Map(rows.map((row) => [row.commitId, row.seconds]));
}

/**
 * The seconds the set was open across the whole session: the union of every
 * segment, across its branches and machines, so overlapping time counts once.
 */
export async function sessionTimeInSet(sessionId: number): Promise<number> {
  const { rows } = await db.execute<{ seconds: number | null }>(sql`
    select round(extract(epoch from sum(upper(span) - lower(span))))::float8 as seconds
      from (
        select unnest(range_agg(tsrange(started_at, ended_at))) as span
          from time_segments
         where session_id = ${sessionId}
      ) spans
  `);
  return rows[0]?.seconds ?? 0;
}
