"use client";

import { SETTINGS, type SettingKey } from "@workspace/settings";
import { useHubKeysWhere } from "./hub-rows";
import { waitsOnRestart } from "./row-view";

/**
 * A quiet notice under a section's head while any of `keys`, its
 * restart-required settings, holds a value the server does not run with yet,
 * naming each. It is one notice however many settings, and however many
 * changes, wait on the restart, and it goes once every value matches the
 * running one again: set back, or restarted into. Rendered only while it has
 * something to say, like the hub's other notices, so it takes no room in the
 * page's rhythm otherwise.
 */
export function RestartNotice({ keys }: { keys: readonly SettingKey[] }) {
  const pending = useHubKeysWhere(keys, waitsOnRestart);
  if (pending.length === 0) return null;

  return (
    <p
      role="status"
      className="max-w-[54ch] border-l border-rule-strong pl-3 text-small text-pretty text-ink-soft"
    >
      {pending.length === 1
        ? "A setting waits for the server to restart: "
        : `${pending.length} settings wait for the server to restart: `}
      <span className="text-ink">
        {pending.map((key) => SETTINGS[key].label).join(", ")}
      </span>
      . Until then it runs with the values it started with.
    </p>
  );
}
