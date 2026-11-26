"use client";

import { useInventorySearch } from "@/components/inventory/inventory-search-context";
import { AppLink } from "@/components/navigation/AppLink";
import { useRevealOpenRow } from "@/hooks/use-reveal-open-row";
import { useShellPolicy } from "@/lib/policies/provider";
import { samplesPageHref, type SamplesPageParams } from "@/lib/samples-graph";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { SampleSession, SampleUsage } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowMeta,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { pluralizeCount } from "@workspace/session-diff/format";
import { sampleFileName, sampleFolder } from "@workspace/ui/lib/sample-path";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";

type RowsView = Pick<SamplesPageParams, "show" | "library" | "stock">;

function matchesSearch(sample: SampleUsage, query: string): boolean {
  return (
    sampleFileName(sample.path).toLowerCase().includes(query) ||
    sampleFolder(sample.path).toLowerCase().includes(query)
  );
}

/**
 * The samples the tab and the Library toggle left standing, most-shared first,
 * as rows that open on `?sample=` to list the sets using them. The search box
 * lives in the page head; this list only reads it, from
 * {@link useInventorySearch}. `emptyLine` is what to say when the server left
 * no sample to list.
 */
export function SampleRows({
  projectId,
  samples,
  view,
  emptyLine,
  expanded,
}: {
  projectId: number;
  samples: SampleUsage[];
  /** The tab, Library and stock-chain state the rows link within; a row's
   *  link adds `sample`. */
  view: RowsView;
  emptyLine: string;
  /** The open row's path and the sets that use it, already read by the server. */
  expanded?: { path: string; sessions: SampleSession[] };
}) {
  const { query } = useInventorySearch();
  const listRef = useRevealOpenRow<HTMLDivElement>(expanded?.path);

  const visible = useMemo(
    () =>
      query
        ? samples.filter((sample) => matchesSearch(sample, query))
        : samples,
    [samples, query]
  );

  if (samples.length === 0) {
    return <p className="text-small text-ink-soft">{emptyLine}</p>;
  }

  if (visible.length === 0) {
    return <p className="text-small text-ink-soft">No samples match.</p>;
  }

  return (
    <div ref={listRef}>
      <Rows>
        {visible.map((sample) => (
          <SampleRow
            key={sample.path}
            projectId={projectId}
            sample={sample}
            view={view}
            sessions={
              expanded?.path === sample.path ? expanded.sessions : undefined
            }
          />
        ))}
      </Rows>
    </div>
  );
}

function SampleRow({
  projectId,
  sample,
  view,
  sessions,
}: {
  projectId: number;
  sample: SampleUsage;
  view: RowsView;
  sessions?: SampleSession[];
}) {
  const open = sessions !== undefined;
  const name = sampleFileName(sample.path);
  const folder = sampleFolder(sample.path);
  const defaults = useShellPolicy().inventoryDefaults.samples;

  return (
    <>
      <Row
        as={AppLink}
        href={samplesPageHref(
          projectId,
          { ...view, sample: open ? undefined : sample.path },
          defaults
        )}
        scroll={false}
        aria-current={open ? "true" : undefined}
        title={sample.path}
        className={cn(open && "border-l-2 border-art")}
      >
        <RowMain>
          <RowTitle
            className={cn(sample.missing && "text-ink-faint line-through")}
          >
            {sample.missing && <span aria-hidden>− </span>}
            {name}
          </RowTitle>
          {folder && <RowMeta>{folder}</RowMeta>}
        </RowMain>
        {sample.missing && (
          <span className="shrink-0 text-micro text-ink-soft">missing</span>
        )}
        <span className="w-16 shrink-0 text-right text-micro text-ink-soft tabular-nums">
          {pluralizeCount(sample.sessions, "set")}
        </span>
      </Row>
      {sessions && (
        <SampleSessionRows projectId={projectId} sessions={sessions} />
      )}
    </>
  );
}

/** The sets that use a sample, drilled in under its row. */
function SampleSessionRows({
  projectId,
  sessions,
}: {
  projectId: number;
  sessions: SampleSession[];
}) {
  if (sessions.length === 0) {
    return (
      <p className="py-2 pl-8 text-micro text-ink-soft">
        No set uses this sample.
      </p>
    );
  }

  return (
    <Rows>
      {sessions.map((session) => (
        <Row
          as={AppLink}
          key={session.id}
          href={hrefFromParsedRoute(
            {
              kind: "session",
              sessionId: session.id,
              trackId: session.trackId ?? undefined,
            },
            projectId
          )}
          className="pl-8"
        >
          <RowMain>
            <RowTitle>{session.name}</RowTitle>
            <RowMeta>
              {[session.trackTitle, session.daw].filter(Boolean).join(" · ")}
            </RowMeta>
          </RowMain>
          {session.status === "missing" && (
            <span className="shrink-0 text-micro text-ink-soft">missing</span>
          )}
        </Row>
      ))}
    </Rows>
  );
}
