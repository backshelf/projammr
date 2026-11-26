"use client";

import {
  createDrainWatch,
  createFinishWatch,
  isActive,
  orderJobs,
  RECENT_WINDOW_MS,
} from "@/components/jobs/jobs-poll";
import { JobsAnnouncer } from "@/components/jobs/JobsAnnouncer";
import {
  createJobsStream,
  type EventSourceLike,
} from "@/components/jobs/jobs-stream";
import { useCurrentRoute } from "@/hooks/use-current-route";
import {
  clientCancelJob,
  clientClearFailedJobs,
  clientGetProjectJobs,
  clientRetryJob,
} from "@/lib/client-api";
import { roleSatisfies } from "@/lib/roles";
import { settingsProjectId } from "@/lib/settings/href";
import type { Job, JobKind, MemberRole } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

type JobsContextValue = {
  /** Every job the project's stream has told this tab about: queued,
   *  running, failed, and finished rows still within their linger. */
  jobsById: ReadonlyMap<number, Job>;
  /** Whether a real read — a stream snapshot or a fallback poll — has landed
   *  for the project in the URL. An empty `jobsById` before this is true is
   *  the placeholder shown while nothing has been checked yet, not a read
   *  that found nothing. */
  loaded: boolean;
  /** Whether the signed-in user may cancel, retry or clear jobs. */
  canManage: boolean;
  cancel: (jobId: number) => Promise<void>;
  retry: (jobId: number) => Promise<void>;
  /** Deletes every failed job of the project, not only the rows shown. */
  clearFailed: () => Promise<void>;
  /**
   * Hands `observe` the running and queued jobs after every update, starting
   * with the latest read when one has already landed. Returns the
   * unsubscribe.
   */
  subscribe: (observe: (active: readonly Job[]) => void) => () => void;
  setRole: (entry: RoleEntry | null) => void;
};

type RoleEntry = { projectId: number; role: MemberRole };

const EMPTY_JOBS: ReadonlyMap<number, Job> = new Map();
const NO_JOBS: Job[] = [];

const JobsContext = createContext<JobsContextValue | null>(null);

type Snapshot = { projectId: number; jobsById: ReadonlyMap<number, Job> };

/**
 * Watches the background queue of the project in the URL and shares one map
 * of it with everything that cares: the tray, and the pages waiting on a
 * measurement to finish.
 *
 * It sits in the app shell rather than the project layout because the desktop
 * sidebar, where the tray lives, is rendered above the project layout. The
 * project in the URL is a `/project/:id` page's, or the one a Project section
 * of the settings hub is for (`/settings/project/:id`), whose uploads follow
 * their jobs here too. Anywhere else it reads nothing.
 *
 * The map is fed by a server-sent-events stream while the tab is on screen,
 * with a timed poll of the collapsed read as a fallback when the stream is
 * down (`jobs-stream.ts`). Nothing here ticks a clock: elapsed time is read
 * by whatever row shows it, from its own `useNow`, so a second passing
 * re-renders that row and nothing above it.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const projectId = useCurrentRoute()?.projectId ?? settingsProjectId(pathname);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [roleEntry, setRoleEntry] = useState<RoleEntry | null>(null);

  // A snapshot from the project just left is stale rather than wrong — this
  // masks it back to empty for the render or two before the new project's
  // stream reports in, instead of a synchronous effect reset.
  const loaded = snapshot?.projectId === projectId;
  const jobsById =
    snapshot?.projectId === projectId ? snapshot.jobsById : EMPTY_JOBS;
  const jobsByIdRef = useLatestRef(jobsById);
  const streamRef = useRef<ReturnType<typeof createJobsStream> | null>(null);
  const subscribersRef = useRef(new Set<(jobs: readonly Job[]) => void>());

  useEffect(() => {
    if (projectId == null) return;

    const stream = createJobsStream({
      createEventSource: () =>
        new EventSource(
          `/api/projects/${projectId}/jobs/events`
        ) as EventSourceLike,
      fetchJobs: async () => {
        const jobs = await clientGetProjectJobs(projectId, RECENT_WINDOW_MS);
        if (isActionError(jobs)) throw new Error(jobs.error);
        return jobs;
      },
      onUpdate: (jobs) => {
        setSnapshot({ projectId, jobsById: jobs });
        const active = [...jobs.values()].filter(isActive);
        for (const observe of subscribersRef.current) observe(active);
      },
      // Every handle these two hand out is tracked and cleared inside
      // `jobs-stream.ts`'s own `stop()`, called from this effect's cleanup —
      // the lint rule cannot see across that boundary.
      // eslint-disable-next-line @eslint-react/web-api-no-leaked-timeout
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      now: () => Date.now(),
    });

    streamRef.current = stream;
    stream.start();

    const onVisibilityChange = () =>
      stream.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stream.stop();
      streamRef.current = null;
    };
  }, [projectId]);

  const subscribe = useCallback(
    (observe: (active: readonly Job[]) => void) => {
      subscribersRef.current.add(observe);
      // Before the stream's first real read, `jobsById` is the empty
      // placeholder (see the masking above), not a read that found nothing —
      // handing that to `observe` would let a drain watch fire for a project
      // whose queue was never actually checked. Once a real read has landed,
      // a subscriber that arrives after it still gets its "first read" call.
      if (streamRef.current?.hasLoaded()) {
        observe([...jobsByIdRef.current.values()].filter(isActive));
      }
      return () => {
        subscribersRef.current.delete(observe);
      };
    },
    [jobsByIdRef]
  );

  const cancel = useCallback(async (jobId: number) => {
    const result = await clientCancelJob(jobId);
    // `null` is a job that had already finished (409): the stream already
    // carries its final row, so there is nothing more to do.
    if (result !== null && isActionError(result)) toast.error(result.error);
  }, []);

  const retry = useCallback(async (jobId: number) => {
    const result = await clientRetryJob(jobId);
    if (isActionError(result)) toast.error(result.error);
  }, []);

  const clearFailed = useCallback(async () => {
    if (projectId == null) return;
    const result = await clientClearFailedJobs(projectId);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    // A delete draws no event from the server, so the rows leave the map by
    // hand rather than waiting on one that will never arrive.
    const failedIds = [...jobsByIdRef.current.values()]
      .filter((job) => job.status === "failed")
      .map((job) => job.id);
    streamRef.current?.remove(failedIds);
  }, [projectId, jobsByIdRef]);

  const canManage =
    roleEntry != null &&
    roleEntry.projectId === projectId &&
    roleSatisfies(roleEntry.role, "editor");

  const value = useMemo<JobsContextValue>(
    () => ({
      jobsById,
      loaded,
      canManage,
      cancel,
      retry,
      clearFailed,
      subscribe,
      setRole: setRoleEntry,
    }),
    [jobsById, loaded, canManage, cancel, retry, clearFailed, subscribe]
  );

  return (
    <JobsContext value={value}>
      {children}
      <JobsAnnouncer jobsById={jobsById} />
    </JobsContext>
  );
}

/** The shared job map, or `null` outside the signed-in shell. */
export function useJobs(): JobsContextValue | null {
  return use(JobsContext);
}

/**
 * The project's jobs in tray order: running first, then queued by position,
 * then rows lingering after they finished or were cancelled, then failed.
 */
export function useProjectJobs(): Job[] {
  const context = useJobs();
  return useMemo(
    () => (context ? orderJobs([...context.jobsById.values()]) : NO_JOBS),
    [context]
  );
}

/** One job's live row, or `undefined` while it is not in the map — not yet
 *  queued, or already pruned past its linger. */
export function useJob(id: number): Job | undefined {
  return useJobs()?.jobsById.get(id);
}

/** Whether a real read has landed for the project in the URL. `false` before
 *  the stream's first snapshot (or its fallback poll) reports in, and outside
 *  a project route where nothing is ever read. */
export function useJobsLoaded(): boolean {
  return useJobs()?.loaded ?? false;
}

/**
 * Calls `onDrain` once none of `kinds` is left on the project's queue: after
 * the first read that finds none, and after every later update where the
 * last of them has gone. `kinds` must be a stable set (a module constant).
 */
export function useJobsDrain(
  kinds: ReadonlySet<JobKind>,
  onDrain: () => void
): void {
  useJobsWatch(createDrainWatch, kinds, onDrain);
}

/**
 * Calls `onFinish` whenever a job of `kinds` that was running or queued has
 * finished, without waiting for the rest of the queue (see
 * `createFinishWatch`). `kinds` must be a stable set (a module constant).
 */
export function useJobsFinish(
  kinds: ReadonlySet<JobKind>,
  onFinish: () => void
): void {
  useJobsWatch(createFinishWatch, kinds, onFinish);
}

type JobsWatch = (
  kinds: ReadonlySet<JobKind>,
  onChange: () => void
) => (active: readonly Job[]) => void;

/** Subscribes one `watch` over `kinds` for the component's life, calling the
 *  latest `onChange` whenever it fires. */
function useJobsWatch(
  watch: JobsWatch,
  kinds: ReadonlySet<JobKind>,
  onChange: () => void
): void {
  const subscribe = useJobs()?.subscribe;
  const onChangeRef = useLatestRef(onChange);

  useEffect(
    () => subscribe?.(watch(kinds, () => onChangeRef.current())),
    [subscribe, watch, kinds, onChangeRef]
  );
}

/**
 * Hands the project layout's role to the provider, which sits above it and so
 * cannot read `ProjectProvider`. Only whether Cancel, Retry and Clear are
 * offered depends on it; the server enforces the rule either way.
 */
export function JobsRole({
  projectId,
  role,
}: {
  projectId: number;
  role: MemberRole;
}) {
  const setRole = useJobs()?.setRole;

  useEffect(() => {
    setRole?.({ projectId, role });
    return () => setRole?.(null);
  }, [setRole, projectId, role]);

  return null;
}
