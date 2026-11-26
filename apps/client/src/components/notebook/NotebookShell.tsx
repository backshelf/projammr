"use client";

import { NOTES_HREF } from "@/lib/utils";
import type { NoteSummary } from "@workspace/api/api";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { cn } from "@workspace/ui/lib/utils";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  use,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Notebook = {
  summaries: NoteSummary[];
  upsert: (summary: NoteSummary) => void;
  remove: (id: number) => void;
};

/**
 * Null outside the notebook: `NoteEditor` also mounts on a track page, where
 * there is no list to keep in step.
 */
const NotebookContext = createContext<Notebook | null>(null);

export const useNotebook = () => use(NotebookContext);

/**
 * The notebook's two panes: the list of notes and the open note's editor. Side
 * by side from `md:` up; below it only one is on screen, chosen by whether a
 * note (or the new-note route) is open.
 */
export function NotebookShell({
  summaries,
  list,
  children,
}: {
  summaries: NoteSummary[];
  list: ReactNode;
  children: ReactNode;
}) {
  const editorOpen = usePathname() !== NOTES_HREF;
  const notebook = useNotebookState(summaries);

  return (
    <NotebookContext value={notebook}>
      <div
        className={
          "grid h-full min-h-0 grid-cols-1 pb-(--dock) md:grid-cols-[18rem_minmax(0,1fr)]"
        }
      >
        <ScrollRoot
          pane="notes"
          className={cn(
            "border-rule bg-paper-sunk md:block md:border-r",
            editorOpen && "hidden"
          )}
        >
          {list}
        </ScrollRoot>
        <ScrollRoot
          pane="note"
          className={cn("md:block", !editorOpen && "hidden")}
        >
          {children}
        </ScrollRoot>
      </div>
    </NotebookContext>
  );
}

/**
 * The list the editor writes back into. It starts as the server's list and is
 * replaced whenever a new one arrives — adjusted during render rather than in
 * an effect, so a route refresh never paints the previous request's notes.
 */
function useNotebookState(seed: NoteSummary[]): Notebook {
  const [seen, setSeen] = useState(seed);
  const [summaries, setSummaries] = useState(seed);

  if (seen !== seed) {
    setSeen(seed);
    setSummaries(seed);
  }

  const upsert = useCallback((summary: NoteSummary) => {
    setSummaries((current) =>
      [summary, ...current.filter((note) => note.id !== summary.id)].sort(
        byListOrder
      )
    );
  }, []);

  const remove = useCallback((id: number) => {
    setSummaries((current) => current.filter((note) => note.id !== id));
  }, []);

  return useMemo(
    () => ({ summaries, upsert, remove }),
    [summaries, upsert, remove]
  );
}

/** The server's order for the list: pinned first, then most recently edited. */
const byListOrder = (a: NoteSummary, b: NoteSummary): number =>
  Number(b.pinned) - Number(a.pinned) ||
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
