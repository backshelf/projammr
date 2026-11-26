"use client";

import { IconSearch } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { MENU_LABEL } from "@workspace/ui/lib/overlay";
import { cn } from "@workspace/ui/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import * as React from "react";

/* ---------------------------------------------------------------------------
   The command palette's shapes. Presentational only — filtering, fetching and
   what a row means all belong to the caller.

   Rows are deliberately quiet. Boldness is spent on the masthead, so a list
   that appears over the page earns attention by being the only thing lit, not
   by shouting: mono titles in ink, tracked-caps labels for anything that names
   a group, and faint ink for everything secondary.

   `shouldFilter={false}` is the expected setting when results come from the
   server already ranked — cmdk would otherwise re-sort them by its own scorer
   and discard the ranking the query worked to produce.
   ------------------------------------------------------------------------- */

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden bg-paper text-ink",
        className
      )}
      {...props}
    />
  );
}

/**
 * The palette as an overlay. It sits above centre — a list that grows
 * downwards stays put as results arrive, rather than shifting under the
 * pointer the way a vertically centred box does.
 *
 * The accessible name is visually hidden: the input's placeholder already says
 * what the surface is for, and a visible title would push the first result
 * further from the caret.
 *
 * On a phone the palette fills the screen, so it rises into place rather
 * than growing from a centre it no longer has.
 */
function CommandDialog({
  title = "Command palette",
  description = "Search, or run a command",
  children,
  className,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  return (
    <Dialog {...props}>
      <DialogContent
        entrance={isMobile ? "sheet" : "pop"}
        // The palette toggles with `mod+k`, a global command. The search
        // field is a typing target, so the key never answers from there
        // (Escape closes it); it closes the palette once focus has left the
        // field, which a modal push would prevent by silencing the global
        // scope.
        modalScope={false}
        className={cn(
          "top-[12vh] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl",
          // `--keyboard` (Dock.tsx) shrinks the palette off `100dvh` on iOS,
          // where the soft keyboard covers the visual viewport without
          // shrinking it, so the results list stays above the keyboard
          // instead of running under it.
          "phone:top-0 phone:h-[calc(100dvh-var(--keyboard,0px))] phone:max-w-none phone:rounded-none",
          // Full-bleed on a phone means the query field would otherwise sit
          // under the status bar.
          "phone:pt-[env(safe-area-inset-top)]",
          // Covering the viewport leaves no scrim to tap and a phone has no
          // Escape key, so the close control is the palette's only way out
          // there — and only there, since a floating card can be dismissed by
          // tapping past it.
          "[&_[data-slot=dialog-close]]:hidden",
          "phone:[&_[data-slot=dialog-close]]:top-[calc(env(safe-area-inset-top)+0.625rem)] phone:[&_[data-slot=dialog-close]]:right-3 phone:[&_[data-slot=dialog-close]]:inline-flex",
          "phone:[&_[data-slot=command-input-wrapper]]:pr-14",
          className
        )}
      >
        <DialogHeader className={"sr-only"}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The query field. Its rule is the only one in the palette — it separates
 *  what you type from what came back. */
function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={"flex items-center gap-2.5 border-b border-rule px-4"}
    >
      <IconSearch className={"size-4 shrink-0 text-ink-faint"} />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-12 w-full bg-transparent text-base text-ink outline-hidden md:text-body",
          "placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[min(24rem,60vh)] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain p-2 outline-none",
        "phone:max-h-none phone:flex-1",
        className
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-10 text-center text-small text-ink-soft", className)}
      {...props}
    />
  );
}

/** A named run of items. The heading uses the menu label shape — it divides a
 *  list rather than naming the surface, so it stays quieter than a title. */
function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden text-ink not-first:mt-1",
        "**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1.5",
        "**:[[cmdk-group-heading]]:font-sub **:[[cmdk-group-heading]]:text-micro",
        "**:[[cmdk-group-heading]]:tracking-[0.1em] **:[[cmdk-group-heading]]:uppercase",
        "**:[[cmdk-group-heading]]:text-ink-faint",
        className
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-2 my-1 h-px bg-rule", className)}
      {...props}
    />
  );
}

/**
 * A selectable row. The highlight is a flat ink wash rather than an
 * artwork-derived tint: a moving selection is the one thing on screen that
 * must stay legible over every cover, and artwork colour there reads as noise.
 */
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 coarse:min-h-11",
        "text-body text-ink outline-hidden motion-ink select-none",
        "data-selected:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-ink-faint [&_svg:not([class*='size-'])]:size-4",
        "data-selected:*:[svg]:text-ink-soft",
        className
      )}
      {...props}
    />
  );
}

/** The secondary line on a row — what tells two similarly-named things apart. */
function CommandItemDetail({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-item-detail"
      className={cn("truncate text-small text-ink-soft", className)}
      {...props}
    />
  );
}

/** The kind of thing a row is, as a tracked-caps tag. */
function CommandItemKind({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-item-kind"
      className={cn(MENU_LABEL, "ml-auto shrink-0 pl-2", className)}
      {...props}
    />
  );
}

/** A keyboard hint, trailing the row. */
function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto shrink-0 pl-2 font-sub text-micro tracking-[0.1em] text-ink-soft",
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandItemDetail,
  CommandItemKind,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
