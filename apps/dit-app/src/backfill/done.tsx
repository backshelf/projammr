import { useId, type JSX, type ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { Kbd } from "@workspace/ui/components/kbd";
import { m, OPTICAL, useReducedMotion } from "@workspace/ui/lib/motion";

import type { BackfillView } from "../backfill-ipc";
import { ErrorLine } from "../error-line";
import type { BackfillActions } from "./actions";
import { useReported } from "./reported";
import { failedFolders, readout } from "./model";

/**
 * The readout arrives as light does, a fade on the arrival curve: the one thing in the window that moves into
 * place. Under reduced motion it is simply there.
 */
function Arrival({ children }: { children: ReactNode }): JSX.Element {
  const reduced = useReducedMotion();
  const className = "flex flex-col gap-3";
  if (reduced) {
    return (
      <div data-reduced-motion="" className={className}>
        {children}
      </div>
    );
  }
  return (
    <m.div
      variants={OPTICAL}
      initial="hidden"
      animate="shown"
      className={className}
    >
      {children}
    </m.div>
  );
}

/**
 * Done: the readout replaces the frame: how far back the history goes and what came in, with the folders that
 * failed still listed under it with their reasons and "Try again".
 */
export function Done({
  view,
  actions,
}: {
  view: BackfillView;
  actions: BackfillActions;
}): JSX.Element {
  const format = useFormat();
  const reported = useReported();
  const readoutId = useId();
  const failed = failedFolders(view.folders);

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <h1 className="sr-only">Bring in projects</h1>
      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-[16vh] pb-10">
        <div className="mx-auto flex max-w-xl flex-col gap-8">
          <Arrival>
            <p
              id={readoutId}
              className="font-heading text-subtitle/tight tracking-[-0.01em] text-balance text-ink"
            >
              {view.summary === null
                ? "Nothing was brought in."
                : readout(view.summary, format)}
            </p>
          </Arrival>
          <ErrorLine error={reported} />
          {failed.length > 0 && (
            <Rows
              as="ul"
              aria-label="Folders that failed"
              className="border-b border-rule"
            >
              {failed.map((folder) => (
                <Row key={folder.path} as="li" className="items-start px-0">
                  <RowMain>
                    <RowTitle title={folder.path}>{folder.title}</RowTitle>
                    <RowMeta className="whitespace-normal text-danger">
                      {folder.state.reason}
                    </RowMeta>
                  </RowMain>
                  <Button
                    variant="outline"
                    onClick={() => void actions.retry(folder.path)}
                  >
                    Try again
                  </Button>
                </Row>
              ))}
            </Rows>
          )}
        </div>
      </main>
      <footer className="flex items-center justify-end gap-2 border-t border-rule px-4 py-2.5">
        {view.summary !== null && view.sessionsPath !== null && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => void actions.openSessions(view.sessionsPath)}
          >
            See sessions not in dit
          </Button>
        )}
        <Button
          size="lg"
          autoFocus
          aria-keyshortcuts="Meta+Enter"
          aria-describedby={readoutId}
          onClick={() => void actions.close()}
        >
          Done
          <Kbd variant="bare" aria-hidden className="text-inherit opacity-70">
            {"\u2318\u21a9"}
          </Kbd>
        </Button>
      </footer>
    </div>
  );
}
