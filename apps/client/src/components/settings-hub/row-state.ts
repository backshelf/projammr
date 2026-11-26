"use client";

import type {
  SettingsPatch,
  SettingsWriteScope,
} from "@/lib/settings/provider";
import { SettingsWriteError } from "@/lib/settings/write-queue";
import type { WrittenSettings } from "@workspace/api/api";
import type { RegisteredSetting } from "@workspace/settings";
import { useEffect, useRef, useState } from "react";
import { lockSettings } from "./api";
import { useHub, useHubRow } from "./hub-rows";
import { rowView, type RowView } from "./row-view";
import { checkValue } from "./validation";

/** Where a row's latest change stands: sent and not yet answered, or just saved. */
export type RowStatus = "idle" | "saving" | "saved";

/** How long a row says "Saved" once its change has landed. */
const SAVED_FOR_MS = 1800;

export type SettingRowState = {
  view: RowView;
  /** What the control shows: the reader's change while it is on its way, else the server's value. */
  value: unknown;
  /** What the lock toggle shows, the same way; absent where the row has no lock. */
  locked: boolean | undefined;
  status: RowStatus;
  /** Why the latest change was not saved, until the next one. */
  error: string | null;
  change(value: unknown): void;
  /** Clears the row's own value so it inherits again. */
  reset(): void;
  setLocked(locked: boolean): void;
  /** Focus left the row: a value the schema refused goes back to the saved one. */
  leave(): void;
};

/**
 * One row's changes and what they look like while they travel. A change shows
 * at once and goes out through the settings write queue, which sends it once
 * the reader pauses; a value the setting's schema refuses stays on screen
 * with the reason and is never sent. When the server answers, the hub rows
 * take its answer and the row shows the server's value again with a brief
 * "Saved"; when it refuses, the row shows the server's value, unchanged, and
 * the reason. Only the latest change speaks for the row: an earlier one
 * landing late changes the hub rows but not the row's status.
 *
 * `null` while the hub has no row for the key or the page no target for the
 * scope.
 */
export function useSettingRow(
  definition: RegisteredSetting,
  scope: SettingsWriteScope
): SettingRowState | null {
  const hub = useHub();
  const row = useHubRow(definition.key);
  const [draft, setDraft] = useState<{ value: unknown } | null>(null);
  const [lockDraft, setLockDraft] = useState<boolean | null>(null);
  const [status, setStatus] = useState<RowStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef(0);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), SAVED_FOR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const target = hub.target(scope);
  if (!row || !target) return null;
  const view = rowView(definition, scope, row);
  const { key } = definition;

  /** Follows one change to the server, speaking for the row while it is still the latest. */
  const follow = (ticket: number, sent: Promise<WrittenSettings>) => {
    setStatus("saving");
    setError(null);
    sent
      .then((rows) => hub.store.landed(target, rows))
      .then(
        () => {
          if (ticket !== latestRef.current) return;
          setDraft(null);
          setLockDraft(null);
          setStatus("saved");
        },
        (failure: unknown) => {
          if (ticket !== latestRef.current) return;
          setDraft(null);
          setLockDraft(null);
          setStatus("idle");
          setError(
            failure instanceof Error
              ? failure.message
              : "Couldn't save the setting"
          );
          // A conflict is a lock set since this page was read; the server's
          // rows show who holds it.
          if (failure instanceof SettingsWriteError && failure.status === 409) {
            void hub.store.reread();
          }
        }
      );
  };

  const write = (patch: SettingsPatch) =>
    hub.write(target.scope, target.id, patch);

  return {
    view,
    value: draft ? draft.value : view.value,
    locked: view.lock ? (lockDraft ?? view.lock.locked) : undefined,
    status,
    error,
    change(value) {
      const ticket = ++latestRef.current;
      setDraft({ value });
      const checked = checkValue(definition, value);
      if (!checked.ok) {
        setStatus("idle");
        setError(checked.message);
        return;
      }
      follow(ticket, write({ [key]: checked.value } as SettingsPatch));
    },
    reset() {
      const ticket = ++latestRef.current;
      setDraft(null);
      follow(ticket, write({ [key]: null } as SettingsPatch));
    },
    setLocked(locked) {
      const ticket = ++latestRef.current;
      setLockDraft(locked);
      follow(
        ticket,
        lockSettings(target, { [key]: locked }).then((rows) => {
          // A lock can move the caller's own effective values too.
          void hub.refresh();
          return rows;
        })
      );
    },
    leave() {
      if (draft === null || status === "saving") return;
      ++latestRef.current;
      setDraft(null);
    },
  };
}
