import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect } from "bun:test";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { jobKey } from "../db/queries/jobs.js";
import { type JobKind, jobs } from "../db/schema/jobs.js";
import { mediaQueue } from "../lib/jobs.js";
import { FFMPEG_PATH } from "../lib/media-binaries.js";
import type { Caller, Suite } from "./fixtures.js";
import { onDiskPath } from "./fixtures.js";

const execFileAsync = promisify(execFile);

export type SettledJob = {
  id: number;
  kind: string;
  status: string;
  percent: number;
  label: string;
  subjectLabel: string | null;
  error: string | null;
  result: {
    assetId?: number;
    url?: string;
    name?: string;
    format?: string;
    kbps?: number | null;
    analysed?: number;
  } | null;
};

/**
 * Waits for each job's run on `mediaQueue` to settle. The queue also holds
 * analyses earlier tests queued and never waited for, so a test waits on the
 * keys it enqueued rather than on `idle()`, which would wait all of them out.
 */
export async function settleJobs(ids: Iterable<number>): Promise<void> {
  await Promise.all([...ids].map((id) => mediaQueue.settled(jobKey(id))));
}

const IN_FLIGHT = inArray(jobs.status, ["queued", "running"]);

async function settleWhere(...where: SQL[]): Promise<void> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(IN_FLIGHT, ...where));
  await settleJobs(rows.map((row) => row.id));
}

/**
 * Waits for the `kind` jobs in flight for the given subjects: the work a lazy
 * reader queues under a job id the test never sees.
 */
export function settleSubjectJobs(
  kind: JobKind,
  subjectIds: number[]
): Promise<void> {
  return settleWhere(eq(jobs.kind, kind), inArray(jobs.subjectId, subjectIds));
}

/** Waits for every job in flight in one project, whoever queued it. */
export function settleProjectJobs(projectId: number): Promise<void> {
  return settleWhere(eq(jobs.projectId, projectId));
}

/** Waits for the job's run and reads it back the way a client polls it. */
export async function settledJob(
  suite: Suite,
  caller: Caller,
  jobId: number
): Promise<SettledJob> {
  await settleJobs([jobId]);
  const res = await suite.request(caller, `/jobs/${jobId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SettledJob;
}

/**
 * Writes a real sine tone to `path`, so the paths that read audio exercise the
 * binaries rather than a stub. The container is `format`, named to ffmpeg
 * rather than read from the extension, since a stored asset's path may have
 * none. `gainDb` applies a `volume` filter, limited so it cannot clip, for
 * fixtures that need the same arrangement at a different loudness; at the
 * default gain the tone is written unfiltered, so a fixture can still reach
 * full scale. `id3`, mp3-only, turns off the ID3v2/v1 tags ffmpeg writes by
 * default, for a fixture that must start with the raw frame sync a bare mp3
 * has instead.
 */
export async function writeTone(
  path: string,
  {
    hz = 440,
    seconds = 0.5,
    format = "wav",
    gainDb = 0,
    id3 = true,
  }: {
    hz?: number;
    seconds?: number;
    format?: "wav" | "flac" | "mp3";
    gainDb?: number;
    id3?: boolean;
  } = {}
): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${hz}:duration=${seconds}`,
    ...(gainDb === 0 ? [] : ["-af", `volume=${gainDb}dB,alimiter=limit=0.98`]),
    ...(format === "mp3" && !id3
      ? ["-id3v2_version", "0", "-write_id3v1", "0"]
      : []),
    "-f",
    format,
    path,
  ]);
}

/**
 * Creates a named pipe at `path` with no writer, so opening it for reading
 * blocks forever — the cheapest way to make ffmpeg hang on purpose. The
 * caller must remove it on every exit path (`rm(path, { force: true })`); a
 * fifo nobody cleans up confuses the next run that reuses its temp directory.
 */
export async function makeStallingFifo(path: string): Promise<void> {
  await execFileAsync("mkfifo", [path]);
}

/**
 * Writes a real fixture whose second half changes to a different pitch, so a
 * duplicate check can be exercised against something that differs by one
 * section rather than throughout.
 */
export async function writeToneWithSection(
  path: string,
  {
    hz = 440,
    sectionHz = 660,
    seconds = 2,
    format = "wav",
  }: {
    hz?: number;
    sectionHz?: number;
    seconds?: number;
    format?: "wav" | "flac" | "mp3";
  } = {}
): Promise<void> {
  const half = seconds / 2;
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${hz}:duration=${half}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${sectionHz}:duration=${half}`,
    "-filter_complex",
    "[0:a][1:a]concat=n=2:v=0:a=1",
    "-f",
    format,
    path,
  ]);
}

/** Turns an uploaded JPEG into real audio, in place, so ffmpeg can read it. */
export async function makeAudible(assetPath: string): Promise<void> {
  await writeTone(onDiskPath(assetPath));
}
