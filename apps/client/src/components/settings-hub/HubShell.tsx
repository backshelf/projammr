"use client";

import {
  Activity,
  useDeferredValue,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { HubNav, type HubNavSection, type HubPlace } from "./HubNav";
import { HubSearchField, HubSearchResults } from "./HubSearch";
import type { HubSearchEntry } from "./layout";
import { groupAnchor } from "./SettingGroupView";

/** How long a row a `#<key>` link lands on stays marked. */
const TARGET_MARK_MS = 1600;

/** The row key a URL's hash names; a malformed escape names none. */
function rowKeyOf(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}

/**
 * The hub around a section's page: the search and the nav in a column on the
 * left, the page on the right; on a phone the two stack, search first. While
 * the search holds a query its results stand in for the page, which keeps its
 * state underneath.
 *
 * On arrival it brings the page's target into view: the row a `#<key>` names,
 * marked for a moment (a machine's row, `#machine-<id>`, also takes focus), or
 * else the group the URL names.
 */
export function HubShell({
  sections,
  place,
  index,
  children,
}: {
  sections: readonly HubNavSection[];
  place: HubPlace;
  index: readonly HubSearchEntry[];
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  // A long list re-renders on every keystroke otherwise; the box keeps up
  // with typing and the results follow.
  const deferred = useDeferredValue(query);
  const searching = deferred.trim() !== "";

  const { entry } = place;
  useEffect(() => {
    const key = rowKeyOf(window.location.hash);
    const row = key === "" ? null : document.getElementById(key);
    const machine = row?.hasAttribute("data-machine-row") ?? false;
    if (row && (machine || row.hasAttribute("data-setting-row"))) {
      row.scrollIntoView({ block: "center" });
      // Focus lets a keyboard or screen reader user land on the machine
      // rather than at the top of the page.
      if (machine) row.focus({ preventScroll: true });
      row.setAttribute("data-target", "");
      const timer = setTimeout(
        () => row.removeAttribute("data-target"),
        TARGET_MARK_MS
      );
      return () => clearTimeout(timer);
    }
    if (entry !== undefined) {
      document.getElementById(groupAnchor(entry))?.scrollIntoView({
        block: "start",
      });
    }
  }, [entry]);

  return (
    <div className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-x-12 phone:grid-cols-1">
      <aside className="sticky top-0 flex flex-col gap-6 pt-(--gutter) phone:static phone:gap-4">
        <HubSearchField value={query} onChange={setQuery} />
        <HubNav sections={sections} place={place} />
      </aside>
      <div className="flex min-w-0 flex-col gap-11 pb-11">
        <Activity mode={searching ? "hidden" : "visible"}>{children}</Activity>
        {searching && (
          <HubSearchResults
            index={index}
            query={deferred}
            onClear={() => setQuery("")}
          />
        )}
      </div>
    </div>
  );
}
