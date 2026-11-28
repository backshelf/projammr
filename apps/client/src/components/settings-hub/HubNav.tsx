"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { SettingsTabNav } from "@/components/settings/SettingsTabNav";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { SettingSection } from "@workspace/settings";
import { Button } from "@workspace/ui/components/button";
import { ResponsivePicker } from "@workspace/ui/components/responsive-picker";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { groupAnchor } from "./SettingGroupView";

/** A section as the nav lists it. */
export type HubNavSection = {
  id: SettingSection;
  label: string;
  detail?: string;
  href: string;
  /** Its groups and panes, and whether any is a pane (a page of its own). */
  entries: { id: string; label: string; href: string }[];
  hasPanes: boolean;
};

/** Where the page is: its section, and the group or pane its URL names. */
export type HubPlace = { section: SettingSection; entry?: string };

/**
 * The hub's sections and what is in each. On a desktop a column: each
 * section's label, with its groups and panes collapsible along a hairline and
 * the active section open by default. On a phone a row of scope tabs, plus a
 * `"Jump to section"` sheet whenever the current scope has groups or panes.
 */
export function HubNav({
  sections,
  place,
  onNavigate,
}: {
  sections: readonly HubNavSection[];
  place: HubPlace;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [seenSection, setSeenSection] = useState(place.section);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [place.section]: true,
  }));

  if (seenSection !== place.section) {
    setSeenSection(place.section);
    setExpanded((prev) =>
      prev[place.section] ? prev : { ...prev, [place.section]: true }
    );
  }

  const current = sections.find(({ id }) => id === place.section);
  const activeEntry = current?.entries.find(({ id }) => id === place.entry);
  const hasJumpEntries = Boolean(current && current.entries.length > 0);

  return (
    <>
      <nav aria-label="Settings" className="flex flex-col gap-5 phone:hidden">
        {sections.map((section) => {
          const open = section.id === place.section;
          const isExpanded = expanded[section.id] ?? open;
          const hasEntries = section.entries.length > 0;

          return (
            <div key={section.id} className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-2">
                <AppLink
                  href={section.href}
                  onClick={onNavigate}
                  aria-current={open && !place.entry ? "page" : undefined}
                  className={cn(
                    LABEL,
                    "min-w-0 flex-1 py-1 motion-ink coarse:py-2.5",
                    open ? "text-ink" : "text-ink-soft hover:text-ink"
                  )}
                >
                  {section.label}
                </AppLink>
                {hasEntries && (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${section.label} sections`}
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [section.id]: !(prev[section.id] ?? open),
                      }))
                    }
                    className="relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-ink-faint motion-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden coarse:after:absolute coarse:after:-inset-2"
                  >
                    <IconChevronRight
                      aria-hidden
                      className={cn(
                        "size-3.5 motion-move",
                        isExpanded && "rotate-90"
                      )}
                    />
                  </button>
                )}
              </div>
              {section.detail && (
                <span className="truncate text-micro text-ink-soft">
                  {section.detail}
                </span>
              )}
              {hasEntries && isExpanded && (
                <ul className="mt-2 flex flex-col border-l border-rule">
                  {section.entries.map((entry) => {
                    const here = open && entry.id === place.entry;
                    return (
                      <li key={entry.id}>
                        <AppLink
                          href={entry.href}
                          onClick={onNavigate}
                          aria-current={here ? "page" : undefined}
                          className={cn(
                            "-ml-px block border-l py-1 pl-3 text-small motion-ink coarse:py-2.5",
                            here
                              ? "border-ink text-ink"
                              : "border-transparent text-ink-soft hover:text-ink"
                          )}
                        >
                          {entry.label}
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div className="hidden phone:block">
        <SettingsTabNav
          activeTab={place.section}
          tabs={sections.map(({ id, label, href }) => ({ id, label, href }))}
          className={hasJumpEntries ? "mb-3" : undefined}
        />
        {hasJumpEntries && current && (
          <ResponsivePicker
            title={`${current.label} sections`}
            options={current.entries.map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
            value={place.entry}
            searchable={current.entries.length > 6}
            searchPlaceholder="Find section…"
            onSelect={(id) => {
              const target = current.entries.find((entry) => entry.id === id);
              if (!target) return;
              onNavigate?.();
              if (target.id === place.entry) {
                document
                  .getElementById(groupAnchor(target.id))
                  ?.scrollIntoView({ block: "start" });
              } else {
                router.push(target.href);
              }
            }}
            trigger={
              <Button
                type="button"
                variant="outline"
                aria-label="Jump to section"
                className="mb-6 flex min-h-11 w-full items-center justify-between gap-2 px-3 font-normal text-ink-soft"
              >
                <span className="min-w-0 truncate">
                  Jump to section
                  {activeEntry && (
                    <span className="text-ink"> · {activeEntry.label}</span>
                  )}
                </span>
                <IconChevronDown
                  aria-hidden
                  className="size-4 shrink-0 text-ink-faint"
                />
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}
