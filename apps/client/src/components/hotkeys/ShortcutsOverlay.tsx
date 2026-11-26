"use client";

import { SHORTCUTS_SCOPE } from "@/components/commands/palette";
import {
  useCommands,
  useCommandScope,
  useShortcutsOverlay,
} from "@/components/commands/provider";
import type { ListedCommand } from "@/components/commands/types";
import { ComboCaps } from "@/components/hotkeys/combo-caps";
import { shortcutGroups } from "@/components/hotkeys/shortcut-groups";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { MENU_LABEL } from "@workspace/ui/lib/overlay";
import { cn } from "@workspace/ui/lib/utils";
import { useId } from "react";

/** One group: a heading and the list it labels. */
function ShortcutSection({
  group,
  rows,
  apple,
}: {
  group: string;
  rows: ListedCommand[];
  apple: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className={MENU_LABEL}>
        {group}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((command) => (
          <ShortcutRow key={command.id} command={command} apple={apple} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A label and its keys. Modifiers read "plus" and chord steps "then" to a
 * screen reader; a command that cannot run here says so in words as well as
 * in its faded ink.
 */
function ShortcutRow({
  command,
  apple,
}: {
  command: ListedCommand;
  apple: boolean;
}) {
  return (
    <li
      data-available={command.available}
      className="flex items-center justify-between gap-4"
    >
      <span
        className={cn(
          "min-w-0 text-small",
          command.available ? "text-ink" : "text-ink-faint"
        )}
      >
        {command.label}
        {!command.available && (
          <span className="sr-only"> (not available on this page)</span>
        )}
      </span>
      <ComboCaps
        combo={command.keys[0] ?? ""}
        apple={apple}
        className="shrink-0"
        capClassName={command.available ? "text-ink-soft" : "text-ink-faint"}
      />
    </li>
  );
}

/**
 * Every command the keyboard can run, whether or not its surface is on this
 * page; one that cannot run here and now is greyed. While open it holds a
 * modal scope above any dialog's, so the `?` that opened it closes it.
 */
export function ShortcutsOverlay() {
  const { open, setOpen } = useShortcutsOverlay();
  const commands = useCommands();
  const apple = useIsApplePlatform();

  useCommandScope(SHORTCUTS_SCOPE, undefined, open, {
    modal: true,
    onTop: true,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Everything the keyboard does. Greyed keys do nothing on this page
            right now.
          </DialogDescription>
        </DialogHeader>
        <div
          role="region"
          aria-label="Shortcuts by group"
          tabIndex={0}
          className="-mr-2 flex max-h-[min(60dvh,32rem)] flex-col gap-6 overflow-y-auto overscroll-contain pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {shortcutGroups(open ? commands : []).map(([group, rows]) => (
            <ShortcutSection
              key={group}
              group={group}
              rows={rows}
              apple={apple}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
