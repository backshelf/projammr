import { useId, useMemo, useState, type JSX } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Empty, EmptyTitle } from "@workspace/ui/components/empty";
import { IconButton } from "@workspace/ui/components/icon-button";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { cn } from "@workspace/ui/lib/utils";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import { useFocusTarget } from "../focus-target";
import type { RenderCard, RepoRow } from "../ipc";
import { usePanelActions } from "../panel-actions";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { matching, recentFirst } from "../repo-list";
import { useCommand } from "../use-command";
import { useOpenBackfill } from "../use-open-backfill";
import { RenderBand } from "../renders/render-list";

const NO_RENDERS: readonly RenderCard[] = [];

/** The repos dit tracks, newest first and filtered as you type; the first-run line when there are none. */
export function Repos({
  repos,
  renders = NO_RENDERS,
  flushTop = true,
}: {
  repos: RepoRow[];
  /** The renders waiting: with no set open, their cards are still the way to decide them. */
  renders?: readonly RenderCard[];
  flushTop?: boolean;
}): JSX.Element {
  const { nav } = usePanelActions();
  const openBackfill = useOpenBackfill();
  const focusTarget = useFocusTarget();
  const [filter, setFilter] = useState("");
  const ordered = useMemo(() => recentFirst(repos), [repos]);
  const shown = useMemo(() => matching(ordered, filter), [ordered, filter]);

  return (
    <div className="flex flex-col gap-4">
      {repos.length === 0 ? (
        <>
          <PanelHead title="Repos" back={nav === "repos"} />
          <RenderBand cards={renders} />
          <Empty className="p-4">
            <EmptyTitle>
              Open a set in Live and dit will offer to track its project, or
              track folders in bulk.
            </EmptyTitle>
            <Button variant="outline" onClick={() => void openBackfill()}>
              {"Track a folder\u2026"}
            </Button>
          </Empty>
        </>
      ) : (
        <>
          <div
            className={cn(
              "sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-rule bg-panel px-4 pb-3",
              flushTop ? "-mt-4 pt-4" : "pt-1"
            )}
          >
            <PanelHead title="Repos" back={nav === "repos"} />
            <PanelInput
              ref={focusTarget}
              type="search"
              aria-label="Filter repos"
              placeholder="Filter repos"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              spellCheck={false}
            />
          </div>
          <RenderBand cards={renders} />
          {shown.length === 0 ? (
            <p className="text-small text-ink-soft">
              No repo matches “{filter.trim()}”.
            </p>
          ) : (
            <Rows as="ul" className="border-b border-rule">
              {shown.map((repo) => (
                <RepoItem key={repo.path} repo={repo} />
              ))}
            </Rows>
          )}
        </>
      )}
    </div>
  );
}

function RepoItem({ repo }: { repo: RepoRow }): JSX.Element {
  const titleId = useId();
  const format = useFormat();
  const { run, error } = useCommand();
  const unreachable = repo.unreachable !== null;

  return (
    <Row as="li" className="flex-wrap items-start px-0">
      <RowMain>
        <RowTitle id={titleId} className={cn(unreachable && "text-ink-soft")}>
          {repo.name}
        </RowTitle>
        <RowMeta
          title={repo.path}
          className={cn((unreachable || repo.busy) && "whitespace-normal")}
        >
          {repoMeta(repo, format)}
        </RowMeta>
      </RowMain>
      {repo.webPath !== null && (
        <IconButton
          aria-label="Open on the web"
          aria-describedby={titleId}
          title="Open on the web"
          className="shrink-0"
          onClick={() =>
            void run(() => call("open_web", { path: repo.webPath }))
          }
        >
          <IconArrowUpRight aria-hidden />
        </IconButton>
      )}
      <ErrorLine error={error} />
    </Row>
  );
}

/** The row's second line: why it cannot be opened, else what it last did, then whether another writer holds it. */
function repoMeta(repo: RepoRow, format: Formatters): string {
  const parts: string[] = [];
  if (repo.unreachable !== null) {
    parts.push(`Can't open the folder: ${repo.unreachable}`);
  } else if (repo.lastCommit) {
    parts.push(
      `${repo.lastCommit.message} · ${format.relative(repo.lastCommit.at)}`
    );
  } else {
    parts.push("No commits yet");
  }
  if (repo.busy) parts.push("waiting for repo");
  return parts.join(" · ");
}
