import type { JSX, ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

import { ErrorLine } from "../error-line";
import { useReported } from "./reported";

const STEPS = [
  { id: "find", label: "Find" },
  { id: "check", label: "Check" },
  { id: "bring-in", label: "Bring in" },
] as const;

/** Which of the three steps is current; the readout after the run is outside them, so none is. */
export type FrameStep = (typeof STEPS)[number]["id"];

/** "FIND · CHECK · BRING IN", the current one in full ink. */
function Steps({ current }: { current: FrameStep }): JSX.Element {
  return (
    <ol
      aria-label="Steps"
      className="flex items-center gap-2 font-sub text-micro tracking-[0.12em] text-ink-soft uppercase"
    >
      {STEPS.map((step, index) => (
        <li key={step.id} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden>·</span>}
          <span
            aria-current={step.id === current ? "step" : undefined}
            className={cn(step.id === current && "text-ink")}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The window's one frame, the same for Find, Check and Bring in: the step's name across the top, the folders on the
 * left, the chosen folder on the right, and a footer for the step's line and its actions. The two panes scroll on
 * their own; the head and the footer stay put.
 */
export function Frame({
  step,
  list,
  detail,
  line,
  actions,
}: {
  step: FrameStep;
  /** The left pane: everything that lists folders. */
  list: ReactNode;
  /** The right pane: the chosen folder. */
  detail: ReactNode;
  /** The footer's line, at its left. */
  line: ReactNode;
  /** The footer's actions, at its right. */
  actions: ReactNode;
}): JSX.Element {
  const reported = useReported();
  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-paper text-ink">
      <header className="flex items-center border-b border-rule px-4 py-2.5">
        <h1 className="sr-only">Bring in projects</h1>
        <Steps current={step} />
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
        <section
          aria-label="Folders"
          className="flex min-h-0 flex-col overflow-y-auto border-r border-rule"
        >
          {list}
        </section>
        <section
          aria-label="Chosen folder"
          className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
        >
          <ErrorLine error={reported} />
          {detail}
        </section>
      </div>
      <footer className="flex items-center gap-3 border-t border-rule px-4 py-2.5">
        <div className="min-w-0 flex-1 text-small text-pretty text-ink-soft">
          {line}
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </footer>
    </div>
  );
}
