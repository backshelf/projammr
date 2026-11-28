"use client";
import { AppLink } from "@/components/navigation/AppLink";
import { cn } from "@workspace/ui/lib/utils";
import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
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
  SidebarMenuAction,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
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
    <SidebarGroup className={cn(separator && "mt-1 border-t border-rule pt-2")}>
      <Collapsible
        open={open}
        onOpenChange={(next) => onCollapsedChange(!next)}
      >
        <div className="relative flex items-center gap-1">
          <CollapsibleTrigger
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-faint hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          >
            <CollapsibleChevron />
          </CollapsibleTrigger>
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
          {hint && (
            <span
              className={cn(
                SIDEBAR_EYEBROW,
                "ml-auto text-ink-faint",
                hrefNew && "mr-6"
              )}
            >
              {hint}
            </span>
          )}
          {hrefNew && newLabel && (
            // A div, not the primitive's default button: the link inside is
            // the control, and a button around a link nests two.
            <SidebarMenuAction key="new" asChild>
              <div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={"ghost"} size={"icon-xs"} asChild>
                      <AppLink href={hrefNew} aria-label={newLabel}>
                        <IconPlus />
                      </AppLink>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{newLabel}</TooltipContent>
                </Tooltip>
              </div>
            </SidebarMenuAction>
          )}
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}
