"use client";

import { describeJobRow } from "@/components/jobs/job-row";
import { useJob } from "@/components/jobs/JobsProvider";
import { useNow } from "@/hooks/use-now";
import type { Job } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { Meter } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { type ComponentProps, useState, useTransition } from "react";

/**
 * The tray's text action: a plain word that runs a request and sits out
 * until it settles.
 */
export function ActionButton({
  onClick,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "onClick"> & {
  onClick: () => Promise<void>;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type={"button"}
      disabled={pending}
      onClick={() => start(onClick)}
      className={cn(
        "shrink-0 text-micro text-ink-soft hover:text-ink disabled:opacity-50 coarse:min-h-11",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type JobRowProps = {
  jobId: number;
  /** How many identical failures this row stands for; 1 for any other row. */
  repeats?: number;
  canManage: boolean;
  onCancel: (jobId: number) => Promise<void>;
  onRetry: (jobId: number) => Promise<void>;
};

/**
 * One row of the tray: the kind's name (and what it is about) as the
 * eyebrow, the current step's label as the title, a progress bar while the
 * job is running, "Step N of M" for a multi-step ladder, and whatever the
 * status line has to say — a queue position, elapsed time, or a finished
 * state. `useJob` keeps it live even after `JobList` re-sorts the row out
 * from under a stale index.
 */
export function JobRow(props: JobRowProps) {
  const job = useJob(props.jobId);
  // `now` never reaches `describeJobRow`'s clock outside the running branch
  // below, so a value frozen at mount reads exactly as well as a fresh one —
  // without calling the impure `Date.now()` during render.
  const [now] = useState(() => Date.now());
  if (!job) return null;

  return job.status === "running" ? (
    <RunningJobRow job={job} {...props} />
  ) : (
    <JobRowLayout job={job} now={now} {...props} />
  );
}

/** Only a running row's elapsed time needs a live clock, so only this row
 *  ticks once a second — the rest of the tray does not re-render for it. */
function RunningJobRow({ job, ...props }: JobRowProps & { job: Job }) {
  const now = useNow(1000);
  return <JobRowLayout job={job} now={now} {...props} />;
}

function JobRowLayout({
  job,
  now,
  repeats = 1,
  canManage,
  onCancel,
  onRetry,
}: JobRowProps & { job: Job; now: number }) {
  const text = describeJobRow(job, now);
  const canCancel =
    canManage && (job.status === "queued" || job.status === "running");
  const canRetry = canManage && job.status === "failed";

  return (
    <Row className={"items-start px-3"}>
      <RowMain className={"flex flex-col gap-1.5"}>
        <RowMeta className={"flex items-baseline gap-2"}>
          <span className={"min-w-0 truncate"}>{text.eyebrow}</span>
          {repeats > 1 && (
            <span
              className={"shrink-0 text-ink tabular-nums"}
              aria-label={`failed ${repeats} times`}
            >
              ×{repeats}
            </span>
          )}
        </RowMeta>
        <RowTitle>{text.title}</RowTitle>
        {job.status === "running" && (
          <Meter
            value={job.percent}
            showValue
            className={"flex-none"}
            aria-label={`${text.title} progress`}
          />
        )}
        {text.stepLine && (
          <RowMeta className={"text-ink-faint"}>{text.stepLine}</RowMeta>
        )}
        {(text.queueLine ?? text.statusLine) && (
          <RowMeta>{text.queueLine ?? text.statusLine}</RowMeta>
        )}
        {job.status === "failed" && job.error && (
          <span
            className={"block text-micro [overflow-wrap:anywhere] text-danger"}
          >
            {job.error}
          </span>
        )}
      </RowMain>
      {canCancel && (
        <ActionButton onClick={() => onCancel(job.id)}>Cancel</ActionButton>
      )}
      {canRetry && (
        <ActionButton onClick={() => onRetry(job.id)}>Retry</ActionButton>
      )}
    </Row>
  );
}
