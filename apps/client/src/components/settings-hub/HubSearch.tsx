"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { IconSearch } from "@tabler/icons-react";
import { Input } from "@workspace/ui/components/input";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { SETTINGS } from "@workspace/settings";
import { useMemo } from "react";
import type { HubSearchEntry } from "./layout";
import { searchSettings } from "./search";
import { SettingRow } from "./SettingRow";

/** The hub's search box. Escape clears it. */
export function HubSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <IconSearch
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder="Search settings"
        aria-label="Search settings"
        autoComplete="off"
        spellCheck={false}
        className="pl-7"
      />
    </div>
  );
}

type ResultGroup = {
  id: string;
  section: string;
  group: string;
  groupHref: string;
  rows: HubSearchEntry[];
};

/** Matches in index order, gathered under the group each belongs to. */
function groupResults(matches: readonly HubSearchEntry[]): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const match of matches) {
    const id = match.groupHref;
    const group = groups.get(id) ?? {
      id,
      section: match.section,
      group: match.group,
      groupHref: match.groupHref,
      rows: [],
    };
    group.rows.push(match);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/**
 * The rows across every section the caller can open whose setting matches
 * the query, live and editable where they stand, under their group and the
 * section it is in.
 */
export function HubSearchResults({
  index,
  query,
  onClear,
}: {
  index: readonly HubSearchEntry[];
  query: string;
  onClear: () => void;
}) {
  const groups = useMemo(
    () => groupResults(searchSettings(index, query)),
    [index, query]
  );
  const count = groups.reduce((sum, { rows }) => sum + rows.length, 0);

  return (
    <div className="flex flex-col gap-11 pt-(--gutter)">
      <div className="flex flex-col items-start gap-2">
        <p role="status" className="text-small text-ink-soft">
          {count === 0
            ? "No settings match"
            : `${count} ${count === 1 ? "setting matches" : "settings match"}`}
          <span className="text-ink"> “{query.trim()}”</span>
        </p>
        {count === 0 && (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer text-small text-art underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Clear the search
          </button>
        )}
      </div>
      {groups.map((group) => (
        <section key={group.id} aria-label={`${group.group}, ${group.section}`}>
          <SectionHead
            action={
              <AppLink
                href={group.groupHref}
                className={cn(
                  LABEL,
                  "text-ink-faint motion-ink hover:text-ink"
                )}
              >
                {group.section}
              </AppLink>
            }
          >
            {group.group}
          </SectionHead>
          <Rows>
            {group.rows.map(({ key, scope }) => (
              <SettingRow
                key={`${scope}:${key}`}
                definition={SETTINGS[key]}
                scope={scope}
              />
            ))}
          </Rows>
        </section>
      ))}
    </div>
  );
}
