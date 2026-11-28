"use client";

import { CollapsibleGroup } from "@/components/sidebar/CollapsibleGroup";
import { useShellPolicy } from "@/lib/policies/provider";
import { shownSections, type SidebarSectionId } from "@/lib/policies/shell";
import { useUserSettingsWrite } from "@/lib/settings/provider";
import { toastRefusedWrite } from "@/lib/settings/refusal";
import type { ReactNode } from "react";

/** A section the sidebar can show: its heading's links, then its list. */
export type SidebarSectionContent = {
  label: string;
  hrefNew?: string;
  /** The "+" link's accessible name and tooltip. */
  newLabel?: string;
  hrefAll?: string;
  separator?: boolean;
  hint?: string;
  children: ReactNode;
};

/**
 * The sidebar's sections, in the shell policy's order and without those it
 * hides, each collapsed or open as the policy says. Folding or unfolding one
 * writes the viewer's sidebar-sections setting, which the sidebar follows at
 * once, before the server has answered.
 *
 * `sections` is what the sidebar has to show where it is: a section it leaves
 * out (the project's own, off the project tree) is not shown whatever the
 * policy says.
 */
export function SidebarSections({
  sections,
}: {
  sections: Partial<Record<SidebarSectionId, SidebarSectionContent>>;
}) {
  const { sidebarSections } = useShellPolicy();
  const write = useUserSettingsWrite();

  const fold = (id: SidebarSectionId, collapsed: boolean) => {
    write({
      "layout.sidebarSections": sidebarSections.map((section) =>
        section.id === id ? { ...section, collapsed } : section
      ),
    }).catch(toastRefusedWrite);
  };

  return shownSections(sidebarSections).map(({ id, collapsed }) => {
    const section = sections[id];
    if (!section) return null;
    const { children, ...heading } = section;

    return (
      <CollapsibleGroup
        key={id}
        {...heading}
        collapsed={collapsed}
        onCollapsedChange={(next) => fold(id, next)}
      >
        {children}
      </CollapsibleGroup>
    );
  });
}
