"use client";
import { AppLink } from "@/components/navigation/AppLink";
import { IconPlus } from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * One sidebar section under its heading. Whether it is collapsed is its
 * owner's to hold: the group shows `collapsed` and reports a toggle through
 * `onCollapsedChange`, so the state can live wherever the shell keeps it.
 */
export function CollapsibleGroup({
  label,
  hrefNew,
  newLabel,
  hrefAll,
  separator = false,
  hint,
  collapsed,
  onCollapsedChange,
  children,
}: {
  label: string;
  hrefNew?: string;
  /** The "+" link's accessible name and tooltip — the entity it creates
   *  ("New track"), since `label` names the group ("Tracks") instead. */
  newLabel?: string;
  hrefAll?: string;
  separator?: boolean;
  hint?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const open = !collapsed;

  return (
    <SidebarGroup className={cn(separator && "border-t border-rule pt-3")}>
      <Collapsible
        open={open}
        onOpenChange={(next) => onCollapsedChange(!next)}
      >
        <div className="flex h-6 items-center gap-0.5 pr-0.5 pl-2">
          {hrefAll ? (
            <SidebarGroupLabel asChild>
              <AppLink
                href={hrefAll}
                className={cn(SIDEBAR_EYEBROW, "text-ink-soft hover:text-ink")}
              >
                {label}
              </AppLink>
            </SidebarGroupLabel>
          ) : (
            <SidebarGroupLabel className={cn(SIDEBAR_EYEBROW, "text-ink-soft")}>
              {label}
            </SidebarGroupLabel>
          )}
          <CollapsibleTrigger
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-faint motion-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 focus-visible:outline-hidden"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          >
            <CollapsibleChevron />
          </CollapsibleTrigger>
          {hint && (
            <span
              className={cn(
                SIDEBAR_EYEBROW,
                "ml-auto hidden min-w-0 truncate text-ink-faint @[13.5rem]/sidebar:inline"
              )}
            >
              {hint}
            </span>
          )}
          {hrefNew && newLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AppLink
                  href={hrefNew}
                  aria-label={newLabel}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-soft motion-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 focus-visible:outline-hidden",
                    !hint && "ml-auto"
                  )}
                >
                  <IconPlus className="size-3.5" aria-hidden />
                </AppLink>
              </TooltipTrigger>
              <TooltipContent>{newLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <CollapsibleContent>
          <SidebarGroupContent className="pt-1">{children}</SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}
