"use client";

import {
  matchPrefixCommand,
  PREFIX_COMMANDS,
  type PrefixCommand,
  type PrefixRow,
} from "@/components/command-palette/action-context";
import {
  prefixCandidates,
  usePrefixCommandResults,
} from "@/components/command-palette/use-prefix-command";
import type { ActionContext } from "@/components/commands/types";
import type { CommandBarSuggestion } from "@workspace/ui/components/command-bar/prompt";
import { useRef } from "react";

function rowKey(row: PrefixRow): string {
  return row.kind === "search"
    ? `${row.result.type}-${row.result.id}`
    : `local-${row.id}`;
}

function rowSuggestion(
  command: PrefixCommand,
  row: PrefixRow,
  ctx: ActionContext
): CommandBarSuggestion {
  const run = () => void command.run(row, ctx);
  return row.kind === "search"
    ? {
        id: rowKey(row),
        label: row.result.title,
        hint: row.result.subtitle || undefined,
        run,
      }
    : { id: rowKey(row), label: row.title, hint: row.subtitle, run };
}

/**
 * The bar prompt's line as the palette's prefix engine reads it: a complete
 * prefix (or alias) yields that command's rows, a partial one the available
 * commands it could still become. Choosing a row runs the command as the
 * palette does; choosing a command completes the line and keeps the prompt
 * open.
 *
 * The prompt closes after every choice, so the returned `onClose` skips the
 * one a completion causes and otherwise calls `close`.
 */
export function useBarPrompt({
  value,
  setValue,
  close,
  ctx,
  aliases,
}: {
  value: string;
  setValue: (value: string) => void;
  close: () => void;
  ctx: ActionContext;
  aliases: Readonly<Record<string, string>>;
}) {
  const match = matchPrefixCommand(PREFIX_COMMANDS, value, aliases);
  const { activeMatch, candidates } = prefixCandidates(match, value, ctx);
  const { results } = usePrefixCommandResults(
    activeMatch?.command ?? null,
    activeMatch?.remainder ?? "",
    ctx
  );

  const completedRef = useRef(false);

  const suggestions: CommandBarSuggestion[] = activeMatch
    ? results.map((row) => rowSuggestion(activeMatch.command, row, ctx))
    : candidates.map((command) => ({
        id: command.id,
        label: command.prefix.trim(),
        hint: command.description,
        run: () => {
          completedRef.current = true;
          setValue(command.prefix);
        },
      }));

  function onClose() {
    if (completedRef.current) {
      completedRef.current = false;
      return;
    }
    close();
  }

  return { suggestions, onClose };
}
