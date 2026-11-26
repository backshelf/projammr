import { Kbd } from "@workspace/ui/components/kbd";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import {
  formatCombo,
  type Combo,
  type KeymapState,
} from "@workspace/ui/lib/keymap";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import { PromptLine, type CommandBarPrompt } from "./prompt";

/** A command as the bar offers it: its keys side by side, then its label. */
export type CommandBarCommand = {
  id: string;
  keys: readonly Combo[];
  label: string;
};

export type CommandBarProps = {
  /** The keymap's state: its pending chord, its count, and what could follow. */
  state: Pick<KeymapState, "pending" | "count" | "candidates">;
  /** What the bar offers while nothing is pending. */
  commands: readonly CommandBarCommand[];
  position: "bottom" | "top";
  /** `always` stays up; `pending` shows only while a chord, a count or the prompt is. */
  mode: "always" | "pending";
  prompt?: CommandBarPrompt;
  /** Trailing content at the bar's end: a note, an undo, a key to the rest. */
  children?: React.ReactNode;
  className?: string;
};

/** A key hint: the keys that do something, then what it is. No keys, no hint. */
export function CommandHint({
  keys,
  label,
  className,
}: {
  keys: readonly Combo[];
  label: React.ReactNode;
  className?: string;
}) {
  const apple = useIsApplePlatform();
  if (keys.length === 0) return null;

  return (
    <span
      data-slot="command-hint"
      className={cn("flex min-w-0 shrink-0 items-baseline gap-1.5", className)}
    >
      <Kbd variant="bare">
        {keys.map((key) => formatCombo(key, apple)).join(" ")}
      </Kbd>
      <span className="truncate text-micro text-ink-soft">{label}</span>
    </span>
  );
}

/**
 * The bar along a page's edge. At rest it names the keys that matter now;
 * while a count or a chord is building it shows what has been typed and what
 * could follow it; with the prompt open it is the prompt.
 */
export function CommandBar({
  state,
  commands,
  position,
  mode,
  prompt,
  children,
  className,
}: CommandBarProps) {
  const apple = useIsApplePlatform();
  const building = state.pending.length > 0 || state.count !== null;
  const prompting = prompt?.open === true;
  if (mode === "pending" && !building && !prompting) return null;

  const Edge = position === "top" ? "header" : "footer";
  const typed = `${state.count ?? ""}${state.pending
    .map((press) => formatCombo(press, apple))
    .join("")}`;

  return (
    <Edge
      data-slot="command-bar"
      data-position={position}
      className={cn(
        "relative z-20 flex h-10 shrink-0 items-center gap-6 border-rule bg-paper-sunk px-4",
        position === "top" ? "border-b" : "border-t",
        className
      )}
    >
      {prompt && prompting ? (
        <PromptLine prompt={prompt} position={position} />
      ) : (
        <>
          {building ? (
            <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
              <span className="font-sub text-small text-ink">{typed}</span>
              {state.pending.length > 0 &&
                state.candidates.map((candidate) => (
                  <CommandHint
                    key={candidate.id}
                    keys={candidate.keys}
                    label={candidate.label}
                  />
                ))}
            </div>
          ) : (
            <ul className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
              {commands
                .filter((command) => command.keys.length > 0)
                .map((command) => (
                  <li key={command.id} className="flex shrink-0">
                    <CommandHint keys={command.keys} label={command.label} />
                  </li>
                ))}
            </ul>
          )}
          {children}
        </>
      )}
    </Edge>
  );
}
