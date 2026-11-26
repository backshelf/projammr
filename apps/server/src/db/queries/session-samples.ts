import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { db, type Tx } from "../index.js";
import {
  SAMPLE_KINDS,
  SAMPLE_STATUSES,
  type SampleKind,
  type SampleStatus,
  type SessionSample,
} from "../schema/samples.js";
import { repoObjects } from "../schema/objects.js";
import { saves } from "../schema/saves.js";
import { sessionSamples } from "../schema/session-samples.js";
import { sessions } from "../schema/sessions.js";
import { tracks } from "../schema/tracks.js";

/**
 * The list as it is stored: a path listed twice keeps the last entry's kind
 * and status, at the last entry's place.
 */
function storedOrder(samples: SessionSample[]): SessionSample[] {
  const byPath = new Map<string, SessionSample>();
  for (const sample of samples) {
    byPath.delete(sample.path);
    byPath.set(sample.path, sample);
  }
  return [...byPath.values()];
}

/**
 * Makes `samples` the session's whole list. `position` is the array index; a
 * path listed twice keeps the last entry's kind and status, at the last
 * entry's place.
 */
export async function replaceSessionSamples(
  tx: Tx,
  sessionId: number,
  projectId: number,
  samples: SessionSample[]
): Promise<void> {
  await tx
    .delete(sessionSamples)
    .where(eq(sessionSamples.sessionId, sessionId));
  const list = storedOrder(samples);
  if (list.length === 0) return;
  const rows = list.map((sample, position) => ({
    sessionId,
    projectId,
    path: sample.path,
    kind: sample.kind,
    status: sample.status,
    position,
  }));
  // A dit set's references are not capped, so the insert is batched under the
  // bind limit (a row binds up to ten values).
  for (const batch of chunk(rows, Math.floor(bindParamLimit() / 10))) {
    await tx.insert(sessionSamples).values(batch);
  }
}

/**
 * Each session's samples in position order; a session with none is absent.
 * `executor` is the transaction whose uncommitted rows the read must see.
 */
export async function samplesForSessions(
  sessionIds: number[],
  executor: Pick<typeof db, "select"> = db
): Promise<Map<number, SessionSample[]>> {
  const result = new Map<number, SessionSample[]>();
  if (sessionIds.length === 0) return result;
  const rows = await executor
    .select({
      sessionId: sessionSamples.sessionId,
      path: sessionSamples.path,
      kind: sessionSamples.kind,
      status: sessionSamples.status,
    })
    .from(sessionSamples)
    .where(inArray(sessionSamples.sessionId, sessionIds))
    .orderBy(asc(sessionSamples.sessionId), asc(sessionSamples.position));
  for (const { sessionId, ...sample } of rows) {
    const list = result.get(sessionId);
    if (list) list.push(sample);
    else result.set(sessionId, [sample]);
  }
  return result;
}

/** One sample path a project's sessions reference, and the sessions that do. */
export const sampleUsageSchema = z.object({
  path: z.string(),
  /** The kind the most recently saved session records for the path. */
  kind: z.enum(SAMPLE_KINDS),
  sessions: z.number(),
  sessionIds: z.array(z.number()),
  /** Whether any session reports the file missing. */
  missing: z.boolean(),
});

export type SampleUsage = z.infer<typeof sampleUsageSchema>;

/**
 * Every sample path any session in a project references, most widely shared
 * first and then by path. Sessions whose file was never scanned for samples
 * contribute nothing.
 */
export async function getProjectSamples(
  projectId: number
): Promise<SampleUsage[]> {
  const { rows } = await db.execute<{
    path: string;
    kind: SampleKind;
    sessions: number | string;
    session_ids: number[];
    missing: boolean;
  }>(sql`
    select ss.path,
           (array_agg(ss.kind order by s.updated_at desc, s.id desc))[1] as kind,
           count(distinct ss.session_id) as sessions,
           array_agg(ss.session_id order by ss.session_id) as session_ids,
           bool_or(ss.status = 'missing') as missing
    from ${sessionSamples} ss
    join ${sessions} s on s.id = ss.session_id
    where ss.project_id = ${projectId}
    group by ss.path
    order by sessions desc, ss.path asc
  `);

  return rows.map((row) => ({
    path: row.path,
    kind: row.kind,
    sessions: Number(row.sessions),
    sessionIds: row.session_ids,
    missing: row.missing,
  }));
}

/** One session that references a given sample path. */
export const sampleSessionSchema = z.object({
  id: z.number(),
  name: z.string(),
  daw: z.string(),
  updatedAt: z.date(),
  trackId: z.number().nullable(),
  trackTitle: z.string().nullable(),
  /** Whether this session's file reports the sample present, missing or unknown. */
  status: z.enum(SAMPLE_STATUSES),
});

export type SampleSession = z.infer<typeof sampleSessionSchema>;

/**
 * Every session in a project that references a sample path, most recently
 * saved first. A path no session carries answers an empty list rather than a
 * 404: the caller cannot tell a stale path from a fresh one.
 */
export async function getSessionsBySample(
  projectId: number,
  path: string
): Promise<SampleSession[]> {
  const { rows } = await db.execute<{
    id: number;
    name: string;
    daw: string;
    updated_at_utc: string;
    track_id: number | null;
    track_title: string | null;
    status: SampleStatus;
  }>(sql`
    select s.id, s.name, s.daw,
           to_char(s.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at_utc,
           s.track_id, tr.title as track_title, ss.status
    from ${sessionSamples} ss
    join ${sessions} s on s.id = ss.session_id
    left join ${tracks} tr on tr.id = s.track_id
    where ss.project_id = ${projectId}
      and ss.path = ${path}
    order by s.updated_at desc, s.id desc
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    daw: row.daw,
    // Raw SQL bypasses drizzle's timestamp mapping: the column comes back as
    // an ISO string spelt in UTC, which parses to the stored instant whatever
    // zone the process runs in.
    updatedAt: new Date(row.updated_at_utc),
    trackId: row.track_id,
    trackTitle: row.track_title,
    status: row.status,
  }));
}

/**
 * The session's samples whose bytes the session's repo holds, by path, each
 * with the object id to download it by. A path is held when the newest save's
 * reference to it names an object the repo has a link to; a session with no
 * repo, or whose newest save carries no references, holds none.
 */
export async function heldSampleObjects(
  sessionId: number,
  repoId: number | null
): Promise<Map<string, string>> {
  if (repoId === null) return new Map();
  const [latest] = await db
    .select({ meta: saves.meta })
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(desc(saves.fileUpdatedAt))
    .limit(1);
  const refs = (latest?.meta?.samples ?? []).filter((ref) => ref.object);
  if (refs.length === 0) return new Map();

  const held = new Set<string>();
  const step = Math.max(1, bindParamLimit() - 1);
  for (const batch of chunk(refs, step)) {
    const rows = await db
      .select({ hash: repoObjects.objectHash })
      .from(repoObjects)
      .where(
        and(
          eq(repoObjects.repoId, repoId),
          inArray(
            repoObjects.objectHash,
            batch.map((ref) => ref.object!)
          )
        )
      );
    for (const row of rows) held.add(row.hash);
  }
  return new Map(
    refs
      .filter((ref) => held.has(ref.object!))
      .map((ref) => [ref.path, ref.object!])
  );
}
