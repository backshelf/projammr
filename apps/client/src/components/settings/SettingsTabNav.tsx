"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef } from "react";

export type SettingsTabLink = {
  id: string;
  label: string;
  href: string;
};

export function SettingsTabNav({
  tabs,
  activeTab,
}: {
  tabs: SettingsTabLink[];
  activeTab: string;
}) {
  const activeRef = useRef<HTMLAnchorElement>(null);

  // A phone-width nav can start scrolled to a tab the fade alone wouldn't
  // reveal — bring the active tab on screen once, on mount.
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, []);

  return (
    <nav
      className={cn(
        // The rule is an inset line rather than a border so the active tab's
        // underline can sit on it without overflowing the scroll box, which
        // would otherwise grow a vertical scrollbar.
        "mb-8 flex min-h-11 w-full items-end justify-start gap-6 shadow-[inset_0_-1px_0_var(--rule)]",
        // `scroll-fade-x` masks both scrollable edges transparent, shrinking
        // to nothing at the scroll extremes — the cue that a phone-width nav
        // has a tab clipped off past "Danger zone".
        "scrollbar-none -mx-(--gutter) scroll-fade-x snap-x overflow-x-auto overflow-y-hidden overscroll-x-contain px-(--gutter)"
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <AppLink
            key={tab.id}
            ref={isActive ? activeRef : undefined}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 shrink-0 snap-start items-center pb-2.5 font-sub text-micro tracking-[0.12em] uppercase motion-ink",
              // The active tab is marked by a solid underline sitting on the rule.
              "after:absolute after:inset-[auto_0_0_0] after:h-px after:bg-ink",
              isActive
                ? "text-ink after:opacity-100"
                : "text-ink-soft after:opacity-0 hover:text-ink"
            )}
          >
            {tab.label}
          </AppLink>
        );
      })}
    </nav>
  );
}
