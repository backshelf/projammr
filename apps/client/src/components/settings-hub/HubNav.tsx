"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { SettingsTabNav } from "@/components/settings/SettingsTabNav";
import type { SettingSection } from "@workspace/settings";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

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
 * section's label, then its groups and panes along a hairline, the current
 * page marked by a stretch of ink on the line. On a phone the settings tab
 * idiom instead: a row of sections, and a row of the current section's
 * entries where it has a pane to reach.
 */
export function HubNav({
  sections,
  place,
}: {
  sections: readonly HubNavSection[];
  place: HubPlace;
}) {
  const current = sections.find(({ id }) => id === place.section);

  return (
    <>
      <nav aria-label="Settings" className="flex flex-col gap-6 phone:hidden">
        {sections.map((section) => {
          const open = section.id === place.section;
          return (
            <div key={section.id} className="flex min-w-0 flex-col">
              <AppLink
                href={section.href}
                aria-current={open && !place.entry ? "page" : undefined}
                className={cn(
                  LABEL,
                  "py-1 motion-ink coarse:py-2.5",
                  open ? "text-ink" : "text-ink-soft hover:text-ink"
                )}
              >
                {section.label}
              </AppLink>
              {section.detail && (
                <span className="truncate text-micro text-ink-soft">
                  {section.detail}
                </span>
              )}
              {section.entries.length > 0 && (
                <ul className="mt-2 flex flex-col border-l border-rule">
                  {section.entries.map((entry) => {
                    const here = open && entry.id === place.entry;
                    return (
                      <li key={entry.id}>
                        <AppLink
                          href={entry.href}
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
        />
        {current?.hasPanes && (
          <SettingsTabNav
            activeTab={place.entry ?? ""}
            tabs={current.entries}
          />
        )}
      </div>
    </>
  );
}
