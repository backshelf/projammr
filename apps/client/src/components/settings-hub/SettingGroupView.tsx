"use client";

import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SETTINGS, type SettingKey } from "@workspace/settings";
import type { ReactNode } from "react";
import { GroupDescription, GroupHead } from "./GroupHead";
import type { HubGroupEntry } from "./layout";
import { SettingRow } from "./SettingRow";

/** The id a group's section carries, which a `/settings/<section>/<group>` URL scrolls to. */
export const groupAnchor = (id: string) => `group-${id}`;

/**
 * One group of a section: its head, with the section's action for it beside
 * the label, what it is for, and a row per setting, each anchored by its key.
 * An advanced group folds under its head, with a count of its rows and the
 * action still beside it, until it is opened — open from the start when the
 * URL names it (`opened`).
 */
export function SettingGroupView({
  group,
  action,
  opened = false,
  notes,
}: {
  group: HubGroupEntry;
  action?: ReactNode;
  opened?: boolean;
  /** A line under a setting's row, by key. */
  notes?: Partial<Record<SettingKey, ReactNode>>;
}) {
  const rows = (
    <Rows>
      {group.rows.map(({ key, scope }) => (
        <SettingRow
          key={`${scope}:${key}`}
          definition={SETTINGS[key]}
          scope={scope}
          anchored
          note={notes?.[key]}
        />
      ))}
    </Rows>
  );

  return (
    <section
      id={groupAnchor(group.id)}
      aria-label={group.label}
      className="scroll-mt-(--gutter)"
    >
      {group.advanced ? (
        <CollapsibleSection
          label={group.label}
          count={group.rows.length}
          action={action}
          defaultOpen={opened}
        >
          <GroupDescription>{group.description}</GroupDescription>
          {rows}
        </CollapsibleSection>
      ) : (
        <>
          <GroupHead
            label={group.label}
            description={group.description}
            action={action}
          />
          {rows}
        </>
      )}
    </section>
  );
}
