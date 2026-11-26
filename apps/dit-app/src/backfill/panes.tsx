import type { JSX, ReactNode } from "react";
import { Row, Rows } from "@workspace/ui/components/layout/rows";

import type { BackfillSet } from "../backfill-ipc";
import { backupsLabel } from "./model";

/** The chosen folder's head: its name in the display face, its path under it, and whatever the step puts beside. */
export function ChosenHead({
  name,
  path,
  children,
}: {
  name: string;
  path: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-subtitle/none tracking-[-0.01em] text-balance text-ink">
          {name}
        </h2>
        <p
          title={path}
          className="mt-1 truncate font-mono text-micro text-ink-soft"
        >
          {path}
        </p>
      </div>
      {children}
    </header>
  );
}

/** One line of the window's own words: what to do, what was found, or that nothing was. */
export function Notice({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p
      role="status"
      className="border-l border-rule-strong pl-3 text-small text-pretty text-ink-soft"
    >
      {children}
    </p>
  );
}

/** The sets of the chosen folder before Check has read them: each one's name and its `Backup/` copies. */
export function SetNames({
  sets,
}: {
  sets: readonly BackfillSet[];
}): JSX.Element {
  return (
    <Rows as="ul" aria-label="Sets" className="border-b border-rule">
      {sets.map((set) => (
        <Row key={set.file} as="li" className="gap-3 px-0">
          <span className="min-w-0 flex-1 truncate text-body text-ink">
            {set.name}
          </span>
          <span className="shrink-0 text-micro text-ink-soft tabular-nums">
            {backupsLabel(set.copies)}
          </span>
        </Row>
      ))}
    </Rows>
  );
}
