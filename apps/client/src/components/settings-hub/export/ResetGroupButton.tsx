"use client";

import { toastActionResult } from "@/lib/action-toast";
import type {
  SettingsPatch,
  SettingsWriteScope,
} from "@/lib/settings/provider";
import { SettingsWriteError } from "@/lib/settings/write-queue";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { pluralizeCount } from "@workspace/session-diff/format";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { SettingKey } from "@workspace/settings";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useHub, type HubRowsStore } from "../hub-rows";
import type { HubGroupEntry } from "../layout";
import { groupAnchor } from "../SettingGroupView";

/**
 * The keys of a group a reset clears at the group's scope: all of them. Values
 * under a lock from a wider scope are kept and unseen until it lifts; clearing
 * them is allowed, and changes nothing until then.
 */
const resettableKeys = (group: HubGroupEntry): SettingKey[] =>
  group.rows.map(({ key }) => key);

/** How many of those keys hold a value set at `scope`, the one the group's rows write. */
const ownValues = (
  group: HubGroupEntry,
  scope: SettingsWriteScope,
  store: HubRowsStore
) =>
  resettableKeys(group).filter((key) => {
    const row = store.row(key);
    return row !== undefined && Object.hasOwn(row.values, scope);
  }).length;

/** What the confirm says a reset clears, and what each value goes back to, by the scope it clears at. */
const CLEARS: Record<SettingsWriteScope, (settings: string) => string> = {
  user: (settings) =>
    `Clears the ${settings} you set yourself here. Each goes back to the value it inherits: the project's, the instance's or the default.`,
  project: (settings) =>
    `Clears the ${settings} set for this project. Each goes back to the value it inherits: the instance's or the default.`,
  instance: (settings) =>
    `Clears the ${settings} stored for this instance. Each goes back to its environment variable where one is set, else the default.`,
};

/**
 * "Reset all" on a group's head, while the group holds a value set at the
 * scope its rows write: after a confirm, one write of `null` for each of the
 * group's keys at that scope, through the settings write queue, so every row
 * goes back to what it inherits. The rows repaint from the server's answer;
 * nothing refreshes the route. The hub puts it on each Personal group and on
 * each advanced group of the Instance section.
 */
export function ResetGroupButton({ group }: { group: HubGroupEntry }) {
  const hub = useHub();
  const { store } = hub;
  // A declared group's rows all write the section's one scope.
  const scope = group.rows[0]?.scope;
  // While the confirm is open: how many values of their own it clears, as
  // counted when it opened, so its words hold still while the reset lands.
  const [confirming, setConfirming] = useState<number | null>(null);

  const subscribe = useMemo(
    () => (listener: () => void) => {
      const stops = group.rows.map(({ key }) => store.subscribe(key, listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [store, group]
  );
  const read = () => (scope === undefined ? 0 : ownValues(group, scope, store));
  const own = useSyncExternalStore(subscribe, read, read);

  const target = scope === undefined ? null : hub.target(scope);
  if (!target) return null;

  const cleared = confirming ?? own;

  const reset = async () => {
    const patch = Object.fromEntries(
      resettableKeys(group).map((key) => [key, null])
    ) as SettingsPatch;
    try {
      const rows = await hub.write(target.scope, target.id, patch);
      await store.landed(target, rows);
      toastActionResult({
        ok: true,
        message: `Reset ${pluralizeCount(cleared, `${group.label} setting`)}`,
      });
    } catch (failure) {
      toastActionResult({
        ok: false,
        message:
          failure instanceof Error
            ? failure.message
            : `Couldn't reset ${group.label}`,
      });
      // A conflict is a lock set since the page was read: the rows show it.
      if (failure instanceof SettingsWriteError && failure.status === 409) {
        void store.reread();
      }
    }
  };

  return (
    <>
      {own > 0 && (
        <button
          type="button"
          onClick={() => setConfirming(own)}
          aria-label={`Reset all ${group.label} settings`}
          className={cn(
            LABEL,
            "relative cursor-pointer text-ink-soft motion-ink hover:text-ink",
            "rounded-sm focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-none",
            "coarse:after:absolute coarse:after:-inset-3"
          )}
        >
          Reset all
        </button>
      )}
      <ConfirmDeleteDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Reset ${group.label}?`}
        description={CLEARS[target.scope](pluralizeCount(cleared, "setting"))}
        confirmLabel="Reset"
        onConfirm={reset}
        // A reset that cleared the last value takes the button with it, so
        // focus goes into the group, to its first control, not to nowhere.
        finalFocus={() =>
          ownValues(group, target.scope, store) > 0 ||
          document.getElementById(groupAnchor(group.id))
        }
      />
    </>
  );
}
