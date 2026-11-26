import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { instancePolicy } from "../../lib/instance-policy.js";
import { projectListenerCount, publishJob } from "../../lib/job-events.js";
import { mediaQueue } from "../../lib/jobs.js";
import { errorFields, log } from "../../lib/log.js";
import { MediaLimitError } from "../../lib/media.js";
import {
  type PolicyTimerOptions,
  startPolicyTimer,
} from "../../lib/policy-timer.js";
import { db } from "../index.js";
import {
  type DescribedJob,
  type Job,
  type JobKind,
  jobs,
  type JobStatus,
  type JobStep,
  type NewJob,
} from "../schema/jobs.js";
import type { ProjectResolution } from "./authorization.js";

const logger = log("jobs");

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often finished jobs past the instance's retention are pruned while the process runs. */
const PRUNE_INTERVAL_MS = DAY_MS;

/** The most often a run's progress reaches its row. */
const PROGRESS_INTERVAL_MS = 250;

/** How a handler reports its way up its kind's ladder of steps. */
export type JobReporter = {
  /** Enters the named step; every step before it counts as complete. */
  step: (key: string) => Promise<void>;
  /** 0..1 within the current step, written at most once per 250 ms. */
  progress: (fraction: number) => Promise<void>;
  /**
   * A reporter whose whole 0..1 is the current step, for a handler that runs
   * work of another shape. It climbs `steps`, or one step of its own when
   * given none.
   */
  child: (steps?: readonly JobStep[]) => JobReporter;
  /** Aborts when the job is cancelled; pass it to anything that spawns or waits. */
  readonly signal: AbortSignal;
};

export type JobHandler = (
  job: Job,
  report: JobReporter
) => Promise<Record<string, unknown> | void>;

/**
 * A kind's way of finding the work it has not done yet — every subject with
 * persistent unfinished state, not just the ones a request happens to touch.
 * Boot is what calls this, through `queueOutstandingJobs`, so a restart picks
 * up where a request never came along to notice.
 */
type OutstandingFinder = () => Promise<
  { subjectId: number; projectId: number }[]
>;

/**
 * Names what each job is about, keyed by job id, for a batch of jobs of one
 * kind. A job it has nothing to say about maps to null or is left out.
 */
export type SubjectLabeler = (
  jobs: Job[]
) => Promise<Map<number, string | null>>;

export type JobKindOptions = {
  /** What the kind is doing, as a person reads it: "Converting". */
  label: string;
  /** How many times a job of this kind runs in total before it is left `failed`. */
  maxAttempts?: number;
  /**
   * The ladder every run climbs, in order. Weights are relative and need not
   * sum to anything. A kind that declares none climbs one step named by its
   * `label`.
   */
  steps?: readonly JobStep[];
  subjectLabels?: SubjectLabeler;
  /** Kinds with no sensible "not yet done" state register no finder. */
  outstanding?: OutstandingFinder;
};

type JobKindRegistration = {
  handler: JobHandler;
  label: string;
  maxAttempts: number;
  steps: readonly JobStep[];
  subjectLabels?: SubjectLabeler;
  outstanding?: OutstandingFinder;
};

const registrations = new Map<JobKind, JobKindRegistration>();

/**
 * Delay before a retry, multiplied by the attempt number (5 s, then 10 s).
 * Read at each retry, so a test can shorten it to see a retry happen or
 * lengthen it to act while one waits.
 */
const retryDelayMs = () => Number(process.env.JOB_RETRY_DELAY_MS) || 5000;

/** A row going back to the queue starts its progress over. */
const QUEUED_AGAIN = {
  status: "queued",
  startedAt: null,
  stepIndex: null,
  stepPercent: null,
  percent: 0,
  queuePosition: null,
  cancelRequested: false,
} satisfies Partial<NewJob>;

const oneStepLadder = (label: string): JobStep[] => [
  { key: "run", label, weight: 1 },
];

/**
 * Teaches the runner what a kind of job does and how it is named. The runner
 * only knows how to move a row through queued → running → done/failed/
 * cancelled; the work, the ladder it climbs and the names it goes by belong to
 * the module that owns the kind, so a kind is registered beside its
 * implementation rather than listed here.
 */
export function registerJobHandler(
  kind: JobKind,
  handler: JobHandler,
  { label, maxAttempts = 1, steps, subjectLabels, outstanding }: JobKindOptions
): void {
  const ladder = steps?.length ? [...steps] : oneStepLadder(label);
  if (!(ladder.reduce((sum, step) => sum + step.weight, 0) > 0)) {
    throw new Error(`The ${kind} ladder has no weight to measure progress by`);
  }

  registrations.set(kind, {
    handler,
    label,
    maxAttempts,
    steps: ladder,
    subjectLabels,
    outstanding,
  });
}

/** A kind nothing registered is named by its key: the row still has to read. */
const kindLabel = (kind: JobKind) => registrations.get(kind)?.label ?? kind;

const ladderFor = (kind: JobKind): JobStep[] => [
  ...(registrations.get(kind)?.steps ?? oneStepLadder(kindLabel(kind))),
];

/**
 * Overall completion, 0..100 to one decimal: the weight of the steps before
 * `stepIndex` plus the current step's weight scaled by `stepFraction`.
 */
export function overallPercent(
  steps: readonly JobStep[],
  stepIndex: number,
  stepFraction: number
): number {
  const total = steps.reduce((sum, step) => sum + step.weight, 0);
  if (!(total > 0)) return 0;

  const done = steps
    .slice(0, Math.max(0, stepIndex))
    .reduce((sum, step) => sum + step.weight, 0);
  const current = (steps[stepIndex]?.weight ?? 0) * clampFraction(stepFraction);
  return Math.round(((done + current) / total) * 1000) / 10;
}

const clampFraction = (fraction: number) =>
  Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;

/**
 * A `SubjectLabeler` for a kind whose subject carries a name: `names` looks up
 * each distinct subject once, and every job takes its subject's name.
 */
export function labelsBySubject(
  names: (subjectIds: number[]) => Promise<Map<number, string>>
): SubjectLabeler {
  return async (rows) => {
    const subjectIds = [
      ...new Set(
        rows.flatMap((row) => (row.subjectId == null ? [] : [row.subjectId]))
      ),
    ];
    const named =
      subjectIds.length > 0
        ? await names(subjectIds)
        : new Map<number, string>();

    return new Map(
      rows.map((row) => [
        row.id,
        row.subjectId == null ? null : (named.get(row.subjectId) ?? null),
      ])
    );
  };
}

/**
 * Rows as the API sends them, with the names the server derives on read. Each
 * kind's `subjectLabels` is called once, with every row of that kind.
 */
async function describeJobs(rows: readonly Job[]): Promise<DescribedJob[]> {
  const byKind = new Map<JobKind, Job[]>();
  for (const row of rows) {
    const group = byKind.get(row.kind);
    if (group) group.push(row);
    else byKind.set(row.kind, [row]);
  }

  const subjectLabels = new Map<number, string | null>();
  await Promise.all(
    [...byKind].map(async ([kind, group]) => {
      const resolve = registrations.get(kind)?.subjectLabels;
      if (!resolve) return;
      for (const [id, label] of await resolve(group)) {
        subjectLabels.set(id, label);
      }
    })
  );

  return rows.map((row) => ({
    ...row,
    label: kindLabel(row.kind),
    subjectLabel: subjectLabels.get(row.id) ?? null,
  }));
}

const describeJob = async (row: Job): Promise<DescribedJob> =>
  (await describeJobs([row]))[0]!;

let dispatching: Promise<void> = Promise.resolve();

/**
 * Hands changed rows to the bus with their names. Only rows a project is
 * watching are described. They are described at once but dispatched in the
 * order they were written, so a watcher never sees a row step back to an older
 * state. Naming failing is logged rather than thrown: the write it follows has
 * already happened.
 */
function publish(rows: readonly Job[]): Promise<void> {
  const watched = rows.filter(
    (row) => row.projectId != null && projectListenerCount(row.projectId) > 0
  );
  if (watched.length === 0) return Promise.resolve();

  const described = describeJobs(watched).catch((error: unknown) => {
    logger.error("could not describe changed jobs", {
      ids: watched.map((row) => row.id),
      ...errorFields(error),
    });
    return [];
  });
  dispatching = dispatching.then(async () => {
    for (const job of await described) publishJob(job);
  });
  return dispatching;
}

/** Updates the rows `where` matches and publishes each one it changed. */
async function updateJobs(
  where: SQL | undefined,
  set: Partial<NewJob>
): Promise<Job[]> {
  const rows = await db.update(jobs).set(set).where(where).returning();
  await publish(rows);
  return rows;
}

/**
 * The one path a run's progress reaches its row by. Only a running row takes
 * it, so a write that arrives after the run settled leaves the finished row
 * alone.
 */
async function writeProgress(
  id: number,
  patch: Required<Pick<NewJob, "stepIndex" | "stepPercent" | "percent">>
): Promise<void> {
  await updateJobs(and(eq(jobs.id, id), eq(jobs.status, "running")), patch);
}

/** Places a reporter's position on the run: a step of the row's ladder and a fraction of it. */
type Place = (
  stepIndex: number,
  fraction: number,
  immediate: boolean
) => Promise<void>;

function ladderReporter(
  steps: readonly JobStep[],
  place: Place,
  signal: AbortSignal
): JobReporter {
  let index = 0;

  return {
    signal,
    step: async (key) => {
      const next = steps.findIndex((step) => step.key === key);
      if (next === -1) throw new Error(`No step "${key}" on this ladder`);
      index = next;
      await place(index, 0, true);
    },
    progress: (fraction) => place(index, fraction, false),
    child: (childSteps = oneStepLadder(steps[index]?.label ?? "")) => {
      const parentIndex = index;
      return ladderReporter(
        childSteps,
        (childIndex, fraction, immediate) =>
          place(
            parentIndex,
            overallPercent(childSteps, childIndex, fraction) / 100,
            immediate
          ),
        signal
      );
    },
  };
}

/**
 * The reporter a run hands its handler, and `settle` for the runner to call
 * once the handler returns or throws.
 *
 * `progress` reaches the row at most once per `PROGRESS_INTERVAL_MS`: a call
 * inside the interval is held, and the latest held value is written when the
 * interval ends. `step` writes at once, which supersedes anything held. Writes
 * go out one at a time in the order they were made, and once `settle` is
 * called nothing more is written, so a held write cannot land on a row the
 * runner has already finished.
 */
function runReporter(
  job: Job,
  signal: AbortSignal
): { reporter: JobReporter; settle: () => Promise<void> } {
  let latest = { stepIndex: 0, fraction: 0 };
  let lastWriteAt = -Infinity;
  let held: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let settled = false;

  const write = (): Promise<void> => {
    clearTimeout(held);
    held = undefined;
    lastWriteAt = performance.now();

    const { stepIndex, fraction } = latest;
    const written = writing.then(() =>
      settled
        ? undefined
        : writeProgress(job.id, {
            stepIndex,
            stepPercent: Math.round(fraction * 1000) / 10,
            percent: overallPercent(job.steps, stepIndex, fraction),
          })
    );
    writing = written.catch(() => undefined);
    return written;
  };

  const place: Place = async (stepIndex, fraction, immediate) => {
    if (settled) return;
    latest = { stepIndex, fraction: clampFraction(fraction) };

    const wait = lastWriteAt + PROGRESS_INTERVAL_MS - performance.now();
    if (immediate || wait <= 0) return write();

    held ??= setTimeout(() => {
      write().catch((error: unknown) =>
        logger.warn("could not write job progress", {
          id: job.id,
          ...errorFields(error),
        })
      );
    }, wait);
  };

  return {
    reporter: ladderReporter(job.steps, place, signal),
    settle: async () => {
      settled = true;
      clearTimeout(held);
      await writing;
    },
  };
}

const JOB_KEY_PREFIX = "job:";

/** The key a job's run is queued under on `mediaQueue`. */
export const jobKey = (id: number) => `${JOB_KEY_PREFIX}${id}`;

let renumberWaiting = false;
let renumbering: Promise<void> = Promise.resolve();

/**
 * Writes every waiting row's place in the queue and publishes the rows whose
 * place changed. The queue is the process's, so places run across projects.
 * Calls made while a renumber is waiting to start collapse into it; it reads
 * the queue as it starts, so the order it writes is the latest one.
 */
function renumberQueue(): Promise<void> {
  if (renumberWaiting) return renumbering;
  renumberWaiting = true;

  renumbering = renumbering.then(async () => {
    renumberWaiting = false;
    try {
      await writeQueuePositions();
    } catch (error) {
      logger.error("could not renumber the job queue", errorFields(error));
    }
  });
  return renumbering;
}

/**
 * One statement for the whole queue. Only a `queued` row takes a place: a row
 * that started or was cancelled since the queue was read keeps the null its
 * own transition wrote.
 */
async function writeQueuePositions(): Promise<void> {
  const waiting = mediaQueue
    .pendingKeys()
    .filter((key) => key.startsWith(JOB_KEY_PREFIX))
    .map((key) => Number(key.slice(JOB_KEY_PREFIX.length)));
  if (waiting.length === 0) return;

  const places = sql.join(
    waiting.map((id, index) => sql`(${id}::integer, ${index + 1}::integer)`),
    sql`, `
  );
  const moved = await db
    .update(jobs)
    .set({ queuePosition: sql`places.position` })
    .from(sql`(values ${places}) as places(id, position)`)
    .where(
      and(
        sql`${jobs.id} = places.id`,
        eq(jobs.status, "queued"),
        sql`${jobs.queuePosition} is distinct from places.position`
      )
    )
    .returning();

  await publish(moved);
}

async function scheduleJob(job: Job): Promise<Job> {
  mediaQueue.enqueue(jobKey(job.id), () => runJob(job.id));
  await renumberQueue();
  return job;
}

/** Inserts the row and hands it to the queue, so a response can carry its id. */
export async function enqueueJob(input: NewJob): Promise<Job> {
  const [job] = await db.insert(jobs).values(input).returning();
  if (!job) throw new Error(`Failed to queue ${input.kind} job`);

  await publish([job]);
  return scheduleJob(job);
}

/**
 * Queues an instance job unless one of its kind is already waiting or running.
 * Instance maintenance belongs to no project, so it cannot go through the
 * subject-keyed `enqueueJobsOnce`; the kind itself is the subject. Returns the
 * new job's id, undefined when one was already pending.
 */
export async function enqueueInstanceJob(
  kind: JobKind
): Promise<number | undefined> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.kind, kind), inArray(jobs.status, ["queued", "running"]))
    )
    .limit(1);
  if (pending) return undefined;

  const job = await enqueueJob({ kind, projectId: null });
  return job.id;
}

/** The newest job of an instance kind, narrowed to `statuses` when given. */
export async function lastInstanceJob(
  kind: JobKind,
  statuses?: JobStatus[]
): Promise<Job | undefined> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        statuses ? inArray(jobs.status, statuses) : undefined
      )
    )
    .orderBy(desc(jobs.id))
    .limit(1);
  return row;
}

/**
 * Queues an instance job now and again on `timer`, for as long as the process
 * lives. A queueing failure is logged as `failure`, never thrown. `enqueue` is
 * the queueing step, which a test replaces. Returns the stop.
 */
export function startInstanceJobs(
  enqueue: () => Promise<unknown>,
  failure: string,
  timer: PolicyTimerOptions
): () => void {
  const run = () =>
    void enqueue().catch((error: unknown) =>
      logger.error(failure, errorFields(error))
    );

  run();
  return startPolicyTimer(run, timer);
}

/**
 * Queues one job per subject, skipping the subjects that already have one
 * queued or running. Work that is idempotent per subject — analysing one audio,
 * generating one image's variants — enqueues through this, so a burst of
 * requests for the same files collapses onto the jobs already in flight.
 * Returns a job for every subject: the pending one where there was one, the
 * newly queued one otherwise.
 */
export async function enqueueJobsOnce(
  kind: JobKind,
  subjects: { subjectId: number; projectId: number }[],
  createdBy?: string
): Promise<Job[]> {
  if (subjects.length === 0) return [];

  const pending = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        inArray(
          jobs.subjectId,
          subjects.map((subject) => subject.subjectId)
        ),
        inArray(jobs.status, ["queued", "running"])
      )
    );

  const bySubject = new Map(pending.map((job) => [job.subjectId, job]));
  const missing = subjects.filter(
    (subject) => !bySubject.has(subject.subjectId)
  );
  if (missing.length === 0) return pending;

  const created = await db
    .insert(jobs)
    .values(missing.map((subject) => ({ ...subject, kind, createdBy })))
    .returning();

  await publish(created);
  return [...pending, ...(await Promise.all(created.map(scheduleJob)))];
}

/**
 * The newest job matching a subject, optionally narrowed to the parameters it
 * was queued with. Work that is idempotent per subject — analysing one audio,
 * transcoding one asset to one format — looks here first so a repeat request
 * joins the job already in flight instead of doing everything twice.
 */
export async function findJob(match: {
  kind: JobKind;
  subjectId: number;
  statuses?: JobStatus[];
  params?: Record<string, unknown>;
}): Promise<Job | undefined> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, match.kind),
        eq(jobs.subjectId, match.subjectId),
        match.statuses ? inArray(jobs.status, match.statuses) : undefined,
        match.params
          ? sql`${jobs.result} @> ${JSON.stringify(match.params)}::jsonb`
          : undefined
      )
    )
    .orderBy(desc(jobs.id))
    .limit(1);

  return job;
}

/**
 * Moves a queued row to running and copies its kind's ladder onto it. The
 * `queued` guard is what makes a second claim of the same id update nothing.
 */
async function claimJob(id: number): Promise<Job | undefined> {
  const isQueued = and(eq(jobs.id, id), eq(jobs.status, "queued"));
  const [queued] = await db
    .select({ kind: jobs.kind })
    .from(jobs)
    .where(isQueued);
  if (!queued) return undefined;

  const [job] = await updateJobs(isQueued, {
    status: "running",
    startedAt: new Date(),
    steps: ladderFor(queued.kind),
    stepIndex: 0,
    stepPercent: 0,
    percent: 0,
    queuePosition: null,
  });
  return job;
}

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

/**
 * Ends a running row `cancelled`, leaving its attempts as they were: always
 * when the run was `aborted`, otherwise only if a cancel was asked for.
 */
async function endCancelled(id: number, aborted: boolean): Promise<boolean> {
  const rows = await updateJobs(
    and(
      eq(jobs.id, id),
      eq(jobs.status, "running"),
      aborted ? undefined : eq(jobs.cancelRequested, true)
    ),
    { status: "cancelled", finishedAt: new Date() }
  );
  return rows.length > 0;
}

/**
 * Ends a run whose handler threw. An abort, or any throw once a cancel was
 * asked for, is a cancellation. A `MediaLimitError` is never worth a retry —
 * the input itself is the reason, not the run — so it ends the job `failed`
 * outright however many attempts its kind otherwise allows, with its `code`
 * folded into the stored message. Anything else is a failed attempt: queued
 * again after a growing delay while the kind allows another, `failed` once it
 * does not. Neither of those takes a row whose cancel landed meanwhile; that
 * row ends `cancelled` instead.
 */
async function endFailedRun(job: Job, error: unknown): Promise<void> {
  if (await endCancelled(job.id, isAbortError(error))) return;

  const message = error instanceof Error ? error.message : String(error);
  const limit = error instanceof MediaLimitError ? error : undefined;
  const storedMessage = limit ? `${limit.code}: ${message}` : message;
  const attempts = job.attempts + 1;
  const retry =
    !limit && attempts < (registrations.get(job.kind)?.maxAttempts ?? 1);

  const [row] = await updateJobs(
    and(
      eq(jobs.id, job.id),
      eq(jobs.status, "running"),
      eq(jobs.cancelRequested, false)
    ),
    retry
      ? { ...QUEUED_AGAIN, attempts, error: message }
      : {
          status: "failed",
          attempts,
          error: storedMessage,
          finishedAt: new Date(),
        }
  );

  if (!row) await endCancelled(job.id, true);
  else if (retry) {
    setTimeout(() => void scheduleJob(row), retryDelayMs() * attempts);
  }
}

/** The abort controller of each run in flight in this process, by job id. */
const runs = new Map<number, AbortController>();

/**
 * Runs one row to completion. The claim's `queued` guard is what makes this
 * safe to call twice for the same id: the second call updates no row and
 * returns, so a resumed job never runs beside the one it was resumed from. The
 * run's controller is registered before the claim, so a cancel that lands the
 * moment the row starts still reaches it.
 */
export async function runJob(id: number): Promise<void> {
  // The queue calls this as it starts the job, so everything behind it moves up.
  void renumberQueue();
  if (runs.has(id)) return;

  const controller = new AbortController();
  runs.set(id, controller);
  try {
    const job = await claimJob(id);
    if (job) await runClaimed(job, controller.signal);
  } finally {
    runs.delete(id);
  }
}

async function runClaimed(job: Job, signal: AbortSignal): Promise<void> {
  const { reporter, settle } = runReporter(job, signal);

  try {
    const registration = registrations.get(job.kind);
    if (!registration) throw new Error(`No handler registered for ${job.kind}`);
    signal.throwIfAborted();

    let result: Record<string, unknown> | void;
    try {
      result = await registration.handler(job, reporter);
    } finally {
      await settle();
    }

    // The parameters the job was queued with stay in `result` alongside what
    // the handler produced, so a finished job still matches a repeat request.
    const last = job.steps.length - 1;
    await updateJobs(and(eq(jobs.id, job.id), eq(jobs.status, "running")), {
      status: "done",
      result: { ...job.result, ...result },
      stepIndex: last,
      stepPercent: 100,
      percent: overallPercent(job.steps, last, 1),
      finishedAt: new Date(),
    });
  } catch (error) {
    await settle();
    await endFailedRun(job, error);
  }
}

/**
 * Cancels a job that has not finished, or answers `undefined` for one that
 * has. A queued row ends `cancelled` at once and leaves the queue; a row
 * waiting out a retry delay is not in the queue, and its claim refuses it when
 * the delay ends. A running row is marked `cancelRequested` and its run
 * aborted; the runner ends it `cancelled` once the handler gives up.
 */
export async function cancelJob(id: number): Promise<DescribedJob | undefined> {
  const [dequeued] = await updateJobs(
    and(eq(jobs.id, id), eq(jobs.status, "queued")),
    {
      status: "cancelled",
      cancelRequested: true,
      queuePosition: null,
      finishedAt: new Date(),
    }
  );
  if (dequeued) {
    if (mediaQueue.remove(jobKey(id))) await renumberQueue();
    return describeJob(dequeued);
  }

  const [running] = await updateJobs(
    and(eq(jobs.id, id), eq(jobs.status, "running")),
    { cancelRequested: true }
  );
  if (running) {
    runs.get(id)?.abort();
    return describeJob(running);
  }

  // Neither update matched, but a run that failed in between can have put the
  // row back in the queue for a retry; only a finished row is past cancelling.
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id));
  return row?.status === "queued" || row?.status === "running"
    ? cancelJob(id)
    : undefined;
}

/**
 * Resets a failed job to `queued` with a clean attempt count and schedules it.
 * `undefined` when the job is not `failed` — there is nothing to retry for a
 * job still in flight or already done.
 */
export async function retryJob(id: number): Promise<DescribedJob | undefined> {
  const [job] = await updateJobs(
    and(eq(jobs.id, id), eq(jobs.status, "failed")),
    { ...QUEUED_AGAIN, attempts: 0, error: null, finishedAt: null }
  );
  if (!job) return undefined;

  return describeJob(await scheduleJob(job));
}

/**
 * Re-queues the rows a previous process left unfinished. Nothing else puts a
 * `running` row back in the queue, so without this a restart strands the work
 * half-done and the client polls a job that will never move again.
 */
export async function resumeInterruptedJobs(): Promise<number> {
  const stale = await updateJobs(
    inArray(jobs.status, ["queued", "running"]),
    QUEUED_AGAIN
  );

  await Promise.all(stale.map(scheduleJob));
  return stale.length;
}

/**
 * Deletes finished rows older than `olderThanMs`, by default the instance's
 * `jobs.jobRetentionDays`: finished rows are a log, not state.
 */
export async function pruneFinishedJobs(
  olderThanMs = instancePolicy().jobs.jobRetentionDays * DAY_MS
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const pruned = await db
    .delete(jobs)
    .where(and(isNotNull(jobs.finishedAt), lt(jobs.finishedAt, cutoff)))
    .returning({ id: jobs.id });

  return pruned.length;
}

/**
 * Deletes a project's failed jobs and returns how many went. Retention prunes
 * them after the instance's job retention regardless; this is for an editor
 * who has dealt with the cause and wants the tray's warning gone now. Queued,
 * running and done rows are left alone.
 */
export async function clearFailedJobs(projectId: number): Promise<number> {
  const cleared = await db
    .delete(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.status, "failed")))
    .returning({ id: jobs.id });

  return cleared.length;
}

/**
 * Queues whatever outstanding work every registered kind can find for itself,
 * so a boot finishes analysis nobody's request ever came along to trigger.
 *
 * A subject that already has a job of the kind on record — in flight, done or
 * failed — is left alone. A finder reports state, not whether the work can
 * succeed, so without this an unreadable file would be queued, and fail or
 * finish without effect, on every boot. Finished rows are pruned after the
 * instance's `jobs.jobRetentionDays`, which is how often boot tries such a
 * subject again; Retry is the way to try sooner. One kind's finder failing is
 * logged and skipped rather than stopping the others or the boot.
 */
export async function queueOutstandingJobs(): Promise<
  Partial<Record<JobKind, number>>
> {
  const queued: Partial<Record<JobKind, number>> = {};

  for (const [kind, { outstanding: findOutstanding }] of registrations) {
    if (!findOutstanding) continue;

    try {
      const subjects = await findOutstanding();
      const attempted =
        subjects.length === 0
          ? new Set<number | null>()
          : new Set(
              (
                await db
                  .select({ subjectId: jobs.subjectId })
                  .from(jobs)
                  .where(
                    and(
                      eq(jobs.kind, kind),
                      inArray(
                        jobs.subjectId,
                        subjects.map((subject) => subject.subjectId)
                      )
                    )
                  )
              ).map((job) => job.subjectId)
            );
      const fresh = subjects.filter(
        (subject) => !attempted.has(subject.subjectId)
      );
      queued[kind] = (await enqueueJobsOnce(kind, fresh)).length;
    } catch (error) {
      logger.error("outstanding-work finder failed", {
        kind,
        ...errorFields(error),
      });
    }
  }

  return queued;
}

/**
 * Prunes finished history once a day for as long as the process lives, and
 * again at once when the instance changes its job retention, so a shorter one
 * applies now. `prune` is the pruning step, which a test replaces. Returns the
 * stop.
 */
export function startJobPruning(
  prune: () => Promise<number> = pruneFinishedJobs
): () => void {
  const run = () =>
    void prune()
      .then((pruned) => {
        if (pruned > 0) logger.info("pruned finished jobs", { pruned });
      })
      .catch((error: unknown) =>
        logger.error("could not prune finished jobs", errorFields(error))
      );

  return startPolicyTimer(run, {
    intervalMs: () => PRUNE_INTERVAL_MS,
    runAgainOn: (policy) => policy.jobs.jobRetentionDays,
  });
}

/**
 * Brings the jobs table back in step with the process on boot: old history goes,
 * anything the last process was in the middle of is queued again, and every
 * kind that knows how to find its own unfinished work gets a chance to. History
 * goes on being pruned on a timer from then on.
 */
export async function startJobRunner(): Promise<void> {
  const pruned = await pruneFinishedJobs();
  const resumed = await resumeInterruptedJobs();
  const queued = await queueOutstandingJobs();
  logger.info("job runner started", { pruned, resumed, queued });
  startJobPruning();
}

export async function getJob(id: number): Promise<DescribedJob> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw new HTTPException(404);

  return describeJob(job);
}

/** Finished statuses a read can window by age; a failed row stays until cleared. */
const WINDOWED_STATUSES: JobStatus[] = ["done", "cancelled"];

/**
 * The most jobs one read of a project returns. Failed rows stay until someone
 * clears them, so the list only grows; the cap is on the query rather than a
 * route so every reader of it — the REST fallback, the event stream's opening
 * snapshot, the MCP tool — is bounded the same way.
 */
export const MAX_PROJECT_JOBS = 200;

/**
 * A project's newest jobs, newest first, at most `MAX_PROJECT_JOBS` of them.
 * `statuses` narrows to those statuses. `recentMs` keeps done and cancelled
 * rows only while they finished within the window, which with no `statuses` is
 * everything a watcher shows: whatever is queued or running, every failed row,
 * and what finished moments ago.
 */
export async function getProjectJobs(
  projectId: number,
  {
    statuses,
    recentMs,
  }: { statuses?: readonly JobStatus[]; recentMs?: number } = {}
): Promise<DescribedJob[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, projectId),
        statuses?.length ? inArray(jobs.status, [...statuses]) : undefined,
        recentMs == null
          ? undefined
          : or(
              notInArray(jobs.status, WINDOWED_STATUSES),
              gte(jobs.finishedAt, new Date(Date.now() - recentMs))
            )
      )
    )
    .orderBy(desc(jobs.id))
    .limit(MAX_PROJECT_JOBS);

  return describeJobs(rows);
}

/**
 * Cancels a job, or throws the same errors the REST route answers: 404 for an
 * id that names no job, 409 once the job has already finished. Shared so a
 * caller — the route, an MCP tool — never re-decides what "already finished"
 * means.
 */
export async function cancelJobOrThrow(id: number): Promise<DescribedJob> {
  // 404s an id that names no job, so the 409 below only ever means "this job
  // exists and has already finished".
  await getJob(id);

  const job = await cancelJob(id);
  if (!job) {
    throw new HTTPException(409, { message: "Job has already finished" });
  }
  return job;
}

/** Resolver for `authorizeProject`: a job names the project it belongs to. */
export async function projectIdForJob(id: number): Promise<ProjectResolution> {
  if (Number.isNaN(id)) return null;
  const [row] = await db
    .select({ projectId: jobs.projectId })
    .from(jobs)
    .where(eq(jobs.id, id));

  return row?.projectId ?? null;
}
