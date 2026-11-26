"use client";

import { browserApi } from "@/lib/browser-api";
import type { WrittenSettings } from "@workspace/api/api";
import { toActionResult } from "@workspace/api/lib/action-result";
import type { SettingKey, SettingsValues } from "@workspace/settings";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readEffectiveSettings } from "./browser-read";
import { DEFAULT_SETTINGS, type EffectiveSettings } from "./effective";
import { SettingsStore, type SettingsTransport } from "./store";
import {
  patchKeys,
  SettingsWriteError,
  type SettingsPatch,
  type SettingsWriteFn,
  type SettingsWriteQueue,
} from "./write-queue";

export type { EffectiveSettings } from "./effective";
export type {
  SettingsPatch,
  SettingsWriteFn,
  SettingsWriteScope,
} from "./write-queue";

const browserTransport: SettingsTransport = {
  async send({ scope, id }, patch) {
    return toActionResult<WrittenSettings>(
      await browserApi.PATCH("/api/settings/{scope}/{id}", {
        params: { path: { scope, id: String(id) } },
        body: patch,
      }),
      "Couldn't save the setting"
    );
  },
  read: readEffectiveSettings,
};

const SettingsContext = createContext<SettingsStore | null>(null);

/** The signed-in member's user id, the id their personal writes name. */
const SettingsUserContext = createContext<string | null>(null);

/**
 * Holds the caller's effective settings for every client component below it.
 * `initial` is the server's read for this page. A provider nested inside
 * another, with the `projectId` its values were resolved with, replaces the
 * outer values wholesale; it shares the outer provider's writes and owns
 * `<html>`'s setting attributes until it unmounts.
 *
 * `userId` names the signed-in member, for `useUserSettingsWrite`: the root
 * provider sets it (`null` when nobody is signed in) and a nested provider
 * leaves it out to keep its parent's.
 *
 * A later `initial` with a new version (after a route refresh) replaces what
 * the provider holds; writes still in flight stay on top of it.
 */
export function SettingsProvider({
  initial,
  projectId = null,
  userId,
  children,
}: {
  initial: EffectiveSettings;
  projectId?: number | null;
  userId?: string | null;
  children: ReactNode;
}) {
  const parent = use(SettingsContext);
  const create = () =>
    new SettingsStore(initial, projectId, parent, browserTransport);
  const [store, setStore] = useState(create);
  // A store answers for one project under one parent for its whole life.
  if (store.projectId !== projectId || store.parent !== parent) {
    setStore(create);
  }

  useLayoutEffect(() => store.attach(), [store]);
  useLayoutEffect(() => store.adopt(initial), [store, initial]);

  const provided = <SettingsContext value={store}>{children}</SettingsContext>;
  return userId === undefined ? (
    provided
  ) : (
    <SettingsUserContext value={userId}>{provided}</SettingsUserContext>
  );
}

const subscribeNowhere = () => () => {};

/**
 * One setting's effective value, typed by its key. Re-renders only when that
 * key's value changes. Outside a provider (signed-out pages) it reads the
 * registry default.
 */
export function useSetting<K extends SettingKey>(key: K): SettingsValues[K] {
  const store = use(SettingsContext);
  const read = () => (store?.values ?? DEFAULT_SETTINGS)[key];
  return useSyncExternalStore(store?.subscribe ?? subscribeNowhere, read, read);
}

/** Every effective value. Re-renders on any change; prefer `useSetting`. */
export function useSettings(): SettingsValues {
  const store = use(SettingsContext);
  const read = () => store?.values ?? DEFAULT_SETTINGS;
  return useSyncExternalStore(store?.subscribe ?? subscribeNowhere, read, read);
}

/**
 * A value built from every effective value by `derive`, a stable function,
 * following each change to them. Until the first change it is `server`: the
 * server's own build from the read this provider started with, so the first
 * render hands down the value the server rendered with.
 */
export function useSettingsDerived<T>(
  server: T,
  derive: (values: SettingsValues) => T
): T {
  const values = useSettings();
  const [first] = useState(values);
  return useMemo(
    () => (values === first ? server : derive(values)),
    [values, first, server, derive]
  );
}

export type SettingsWrite = {
  /**
   * Writes settings at one scope. The values apply at once and go to the
   * server once writes to that scope have paused for 300 ms, several keys in
   * one request. Settles when the server has answered, with the hub's view of
   * the keys that request wrote; on a refusal the old values are back and it
   * rejects with a `SettingsWriteError` for the caller to show. Never
   * refreshes the route: server components see the change on the next
   * navigation.
   */
  write: SettingsWriteFn;
  /** Whether any write is waiting to go out or for its answer. */
  pending: boolean;
};

/** Signed out there is nothing to write to. */
const writeNowhere: SettingsWriteFn = (_scope, _id, patch) =>
  Promise.reject(
    new SettingsWriteError(
      { error: "Sign in to change settings", status: 401 },
      patchKeys(patch)
    )
  );

const notPending = () => false;

const refreshNowhere = () => Promise.resolve();

/**
 * Reads the effective settings from the server again, for the nearest
 * provider and every one above it: for a change that is not a settings write
 * (a lock set or lifted), which the providers cannot see coming. Settles once
 * every read has answered. Outside a provider there is nothing to read.
 */
export function useSettingsRefresh(): () => Promise<void> {
  return use(SettingsContext)?.refresh ?? refreshNowhere;
}

/**
 * The write queue behind this settings tree, for a store that tracks its own
 * read's freshness by the queue's landings rather than through
 * `useSettingsWrite` (the hub rows). `null` outside a provider.
 */
export function useSettingsQueue(): SettingsWriteQueue | null {
  return use(SettingsContext)?.queue ?? null;
}

export function useSettingsWrite(): SettingsWrite {
  const queue = use(SettingsContext)?.queue;
  const pending = useSyncExternalStore(
    queue?.subscribePending ?? subscribeNowhere,
    () => queue?.pending ?? false,
    notPending
  );
  return useMemo(
    () => ({ write: queue?.write ?? writeNowhere, pending }),
    [queue, pending]
  );
}

/** The signed-in member's user id, or `null` when nobody is signed in. */
export function useSettingsUserId(): string | null {
  return use(SettingsUserContext);
}

/** Writes settings at the caller's own scope; see `SettingsWrite.write`. */
export type UserSettingsWriteFn = (
  patch: SettingsPatch
) => Promise<WrittenSettings>;

/**
 * Writes the signed-in member's own settings. Signed out it rejects with the
 * same `SettingsWriteError` a write outside a provider does. Does not
 * re-render on pending writes.
 */
export function useUserSettingsWrite(): UserSettingsWriteFn {
  const userId = use(SettingsUserContext);
  const write = use(SettingsContext)?.queue.write;
  return useCallback(
    (patch) =>
      userId === null || !write
        ? writeNowhere("user", "", patch)
        : write("user", userId, patch),
    [userId, write]
  );
}
