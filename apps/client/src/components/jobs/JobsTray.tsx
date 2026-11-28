"use client";

import { BottomSheet } from "@/components/dock/BottomSheet";
import { groupFailures } from "@/components/jobs/job-row";
import { ActionButton, JobRow } from "@/components/jobs/JobRow";
import {
  DRAIN_TICK_MS,
  FAILED_LIMIT,
  isActive,
  type TrayIndicator,
  trayIndicator,
} from "@/components/jobs/jobs-poll";
import { useJobs, useProjectJobs } from "@/components/jobs/JobsProvider";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
} from "@tabler/icons-react";
import type { Job } from "@workspace/api/api";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Rows } from "@workspace/ui/components/layout/rows";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { AnimatePresence, m, OPTICAL, POP } from "@workspace/ui/lib/motion";
import { MENU_LABEL } from "@workspace/ui/lib/overlay";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";

/**
 * The desktop tray: a mark beside the sidebar's search that spins while the
 * project's background work runs and opens the list of it.
 */
export function JobsTray() {
  const tray = useTray();

  return (
    <AnimatePresence>
      {tray && (
        <m.span
          key={"jobs-tray"}
          className={"inline-flex"}
          variants={OPTICAL}
          initial={"hidden"}
          animate={"shown"}
          exit={"leaving"}
        >
          <Popover open={tray.open} onOpenChange={tray.setOpen}>
            <PopoverTrigger asChild>
              <TrayButton indicator={tray.indicator} count={tray.count} />
            </PopoverTrigger>
            <PopoverContent
              align={"start"}
              className={
                "max-h-(--available-height) gap-3 overflow-y-auto overscroll-contain p-0 py-3"
              }
            >
              <JobList />
            </PopoverContent>
          </Popover>
        </m.span>
      )}
    </AnimatePresence>
  );
}

/** The phone tray: the same mark in the top strip, the list in a sheet. */
export function JobsTraySheet() {
  const tray = useTray();

  return (
    <AnimatePresence>
      {tray && (
        <m.span
          key={"jobs-tray"}
          className={"inline-flex"}
          variants={OPTICAL}
          initial={"hidden"}
          animate={"shown"}
          exit={"leaving"}
        >
          <BottomSheet
            title={"Background jobs"}
            open={tray.open}
            onOpenChange={tray.setOpen}
            trigger={
              <TrayButton
                indicator={tray.indicator}
                count={tray.count}
                size={"touch"}
              />
            }
          >
            <div className={"flex flex-col gap-3 py-2"}>
              <JobList />
            </div>
          </BottomSheet>
        </m.span>
      )}
    </AnimatePresence>
  );
}

/**
 * A one-shot clock for the indicator's "just finished" tick: idle until a
 * `done` row's one-second window is open, then ticks once to close it. A
 * project with nothing recently finished schedules nothing, so the tray
 * costs no recurring timer while it is quiet.
 */
function useDrainTick(jobs: readonly Job[]): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const latestFinish = jobs.reduce((latest, job) => {
      if (job.status !== "done" || !job.finishedAt) return latest;
      const finishedAt = new Date(job.finishedAt).getTime();
      return finishedAt > latest ? finishedAt : latest;
    }, 0);
    if (latestFinish === 0) return;

    // A window already past by the time this effect runs closed no later
    // than this render's own `now`, which already reflects that — nothing
    // to schedule.
    const remaining = latestFinish + DRAIN_TICK_MS - Date.now();
    if (remaining <= 0) return;

    const id = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(id);
  }, [jobs]);

  return now;
}

/**
 * The tray's state, or `null` when it is off screen. It stays while its list
 * is open even once the queue empties, so the list does not vanish from under
 * the reader.
 */
function useTray() {
  const context = useJobs();
  const jobs = useProjectJobs();
  const [open, setOpen] = useState(false);
  const now = useDrainTick(jobs);
  if (!context) return null;

  const indicator = trayIndicator({ jobs, now });
  if (indicator === "hidden" && !open) return null;

  return { indicator, count: jobs.filter(isActive).length, open, setOpen };
}

const INDICATOR_ICONS: Record<TrayIndicator, ReactNode> = {
  running: <IconLoader2 className={"animate-spin"} />,
  drained: <IconCircleCheck />,
  failed: <IconAlertTriangle />,
  hidden: <IconCircleCheck />,
};

function TrayButton({
  indicator,
  count,
  className,
  ...props
}: ComponentProps<typeof IconButton> & {
  indicator: TrayIndicator;
  count: number;
}) {
  return (
    <IconButton
      aria-label={
        indicator === "failed" ? "Failed background jobs" : "Background jobs"
      }
      className={cn(
        count > 1 && "inline-flex w-auto items-center gap-1 px-1.5",
        indicator === "failed" && "text-danger hover:text-danger",
        className
      )}
      {...props}
    >
      {/* A tick replacing a spinner pops in from the spot the spinner left,
          so the mark reads as one indicator changing its mind. */}
      <AnimatePresence mode={"wait"} initial={false}>
        <m.span
          key={indicator}
          className={"grid place-items-center"}
          variants={POP}
          initial={"hidden"}
          animate={"shown"}
          exit={"leaving"}
        >
          {INDICATOR_ICONS[indicator]}
        </m.span>
      </AnimatePresence>
      {count > 1 && (
        <span className={"text-micro leading-none tabular-nums"}>{count}</span>
      )}
    </IconButton>
  );
}

function JobList() {
  const context = useJobs();
  const jobs = useProjectJobs();
  if (!context) return null;

  const active = jobs.filter((job) => job.status !== "failed");
  const failed = groupFailures(
    jobs.filter((job) => job.status === "failed").slice(0, FAILED_LIMIT)
  );

  if (active.length === 0 && failed.length === 0) {
    return (
      <p className={"px-3 text-small text-ink-soft"}>Nothing in progress.</p>
    );
  }

  return (
    <>
      {active.length > 0 && (
        <JobSection label={"In progress"}>
          {active.map((job) => (
            <JobRow
              key={job.id}
              jobId={job.id}
              canManage={context.canManage}
              onCancel={context.cancel}
              onRetry={context.retry}
            />
          ))}
        </JobSection>
      )}
      {failed.length > 0 && (
        <JobSection
          label={"Failed"}
          action={
            context.canManage && (
              <ActionButton
                onClick={context.clearFailed}
                aria-label={"Clear failed jobs"}
              >
                Clear
              </ActionButton>
            )
          }
        >
          {failed.map(({ job, ids }) => (
            <JobRow
              key={job.id}
              jobId={job.id}
              repeats={ids.length}
              canManage={context.canManage}
              onCancel={context.cancel}
              // A collapsed row stands for every job in it, so retrying it
              // retries them all.
              onRetry={() =>
                Promise.all(ids.map((id) => context.retry(id))).then(() => {})
              }
            />
          ))}
        </JobSection>
      )}
    </>
  );
}

function JobSection({
  label,
  action,
  children,
}: {
  label: string;
  /** A control for the whole section, sat at the end of its heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={"flex flex-col gap-1"}>
      <div className={"flex items-center justify-between gap-3 px-3"}>
        <h3 className={MENU_LABEL}>{label}</h3>
        {action}
      </div>
      <Rows>{children}</Rows>
    </section>
  );
}
