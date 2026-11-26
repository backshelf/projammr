"use client";

import {
  useSettingsQueue,
  useSettingsRefresh,
  useSettingsWrite,
  type SettingsWriteFn,
  type SettingsWriteScope,
} from "@/lib/settings/provider";
import { isAnsweredFor } from "@/lib/settings/store";
import type {
  SettingsBatch,
  SettingsWriteObserver,
  SettingsWriteQueue,
  SettingsWriteTarget,
} from "@/lib/settings/write-queue";
import type { WrittenSettings } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import type { SettingKey } from "@workspace/settings";
import {
  createContext,
  use,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readSettingsHub } from "./api";
import type { HubRow, HubRows } from "./types";

export type ReadHub = (
  projectId: number | null
) => Promise<HubRows | ActionError>;

/**
 * The hub rows one page shows, resolved with the page's project when it has
 * one. The server's read seeds them; after that they change only by the
 * server's own answers: a write's or a lock's rows where the server resolved
 * them within this page's project, a fresh read where it did not.
 */
export class HubRowsStore {
  private rows: HubRows;
  private seed: HubRows;
  private readonly listeners = new Map<string, Set<() => void>>();
  private reads = 0;
  private latest: Promise<boolean> = Promise.resolve(true);
  /** Each answer's landing: every write of one batch settles with the same answer. */
  private readonly landing = new WeakMap<HubRows, Promise<void>>();
  /** The queue `attach` observes, for `poll` to ask whether a write is in flight. */
  private queue: SettingsWriteQueue | null = null;

  constructor(
    initial: HubRows,
    readonly projectId: number | null,
    private readonly read: ReadHub
  ) {
    this.rows = initial;
    this.seed = initial;
  }

  row = (key: SettingKey): HubRow | undefined => this.rows[key];

  /**
   * Tracks freshness for the rows this mount seeded from, against `queue`'s
   * landings: a mount whose seed a write has since outdated (a page the
   * router cache restored on Back or Forward) re-reads its rows. The hub's
   * read carries no version of its own, but the router cache hands back the
   * very same seed object on such a restore, so its identity in `queue`
   * stands in for one; a fresh server read is always a new object. An
   * outdated seed is never held again: its contents stay stale, so every
   * later restore of it re-reads too.
   *
   * Also observes `queue` for every landing, the hub's own writes included:
   * `row-state.ts` hands this store the same answer object as an argument
   * here, and `landed` dedupes on that object's identity, so a hub write is
   * still processed once.
   */
  attach(queue: SettingsWriteQueue | null): () => void {
    if (queue?.outdatedRead(this.seed)) void this.reread();
    else queue?.holdRead(this.seed);

    const observer: SettingsWriteObserver = {
      queued: () => {},
      landed: (batch: SettingsBatch, rows: WrittenSettings) => {
        void this.landed(batch, rows);
      },
      failed: () => {},
    };
    this.queue = queue;
    const stop = queue?.observe(observer);
    return () => {
      stop?.();
      if (this.queue === queue) this.queue = null;
    };
  }

  subscribe = (key: SettingKey, listener: () => void) => {
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /**
   * Takes a fresh server read of the page, unless it is the one already held,
   * and holds it as {@link attach} holds the first: the router cache can hand
   * this read back on a later Back just as it does the seed.
   */
  adopt(next: HubRows) {
    if (next === this.seed) return;
    this.seed = next;
    this.queue?.holdRead(next);
    this.replace(next);
  }

  /**
   * Takes the rows the server answered a write or a lock at `target` with.
   * Rows resolved without this page's project cannot stand in for its own,
   * so then it reads the page again, falling back on the answer only when
   * that read fails. Settles once the rows are current. An answer already
   * landing (another change of the same batch) is not read for twice.
   */
  landed(target: SettingsWriteTarget, rows: HubRows): Promise<void> {
    const pending = this.landing.get(rows);
    if (pending) return pending;
    const done = this.land(target, rows);
    this.landing.set(rows, done);
    return done;
  }

  private async land(target: SettingsWriteTarget, rows: HubRows) {
    if (isAnsweredFor(target, this.projectId)) {
      this.merge(rows);
      return;
    }
    if (!(await this.reread())) this.merge(rows);
  }

  /**
   * Reads the page's rows again. Settles once the latest read has answered,
   * with whether it could: a read that a later one overtook waits for that
   * one rather than applying what it read.
   */
  reread(): Promise<boolean> {
    const read = ++this.reads;
    const done = this.read(this.projectId)
      .catch((error: unknown): ActionError => ({ error: String(error) }))
      .then((result): boolean | Promise<boolean> => {
        if (read !== this.reads) return this.latest;
        if (isActionError(result)) {
          console.warn("Could not re-read the settings hub:", result.error);
          return false;
        }
        this.replace(result);
        return true;
      });
    this.latest = done;
    return done;
  }

  private merge(rows: HubRows) {
    this.rows = { ...this.rows, ...rows };
    this.notify(Object.keys(rows));
  }

  private replace(next: HubRows) {
    const previous = this.rows;
    this.rows = next;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    this.notify(
      [...keys].filter(
        (key) => previous[key as SettingKey] !== next[key as SettingKey]
      )
    );
  }

  private notify(keys: Iterable<string>) {
    for (const key of keys) {
      for (const listener of this.listeners.get(key) ?? []) listener();
    }
  }
}

type Hub = {
  store: HubRowsStore;
  write: SettingsWriteFn;
  refresh: () => Promise<void>;
  /** Where a row at `scope` writes, or `null` where this page has no such target. */
  target: (scope: SettingsWriteScope) => SettingsWriteTarget | null;
  /** This page's project, or `null` for a page with none (an instance page). */
  projectId: number | null;
};

const HubContext = createContext<Hub | null>(null);

/**
 * Holds the hub rows for everything below it: the section's rows and the
 * search results alike. `initial` is the server's hub read for the page,
 * resolved with `projectId`'s layer; `userId` is the caller's own id, which
 * their personal writes name.
 */
export function HubRowsProvider({
  initial,
  projectId,
  userId,
  children,
}: {
  initial: HubRows;
  projectId: number | null;
  userId: string;
  children: ReactNode;
}) {
  const create = () => new HubRowsStore(initial, projectId, readSettingsHub);
  const [store, setStore] = useState(create);
  if (store.projectId !== projectId) {
    setStore(create);
  }
  const queue = useSettingsQueue();
  useLayoutEffect(() => store.attach(queue), [store, queue]);
  useLayoutEffect(() => store.adopt(initial), [store, initial]);

  // Taken here once rather than in every row, so a write going pending
  // re-renders this provider and not the whole list.
  const { write } = useSettingsWrite();
  const refresh = useSettingsRefresh();

  const hub = useMemo<Hub>(
    () => ({
      store,
      write,
      refresh,
      target: (scope) => {
        if (scope === "user") return { scope, id: userId };
        if (scope === "instance") return { scope, id: "instance" };
        return projectId === null ? null : { scope, id: projectId };
      },
      projectId,
    }),
    [store, write, refresh, userId, projectId]
  );

  return <HubContext value={hub}>{children}</HubContext>;
}

/** The hub the rows below it read and write through. Throws outside a `HubRowsProvider`. */
export function useHub(): Hub {
  const hub = use(HubContext);
  if (!hub) throw new Error("useHub() was called outside a HubRowsProvider");
  return hub;
}

/** One key's hub row, re-rendering only when that row changes. */
export function useHubRow(key: SettingKey): HubRow | undefined {
  const { store } = useHub();
  const subscribe = useMemo(
    () => (listener: () => void) => store.subscribe(key, listener),
    [store, key]
  );
  const read = () => store.row(key);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The keys among `keys` whose hub row passes `test`, in their order,
 * re-rendering only when that list changes rather than on every change to one
 * of their rows. `test` reads the row alone, so it may be written inline.
 */
export function useHubKeysWhere(
  keys: readonly SettingKey[],
  test: (row: HubRow) => boolean
): SettingKey[] {
  const { store } = useHub();
  // Keys hold no line breaks, so the joined list stands for the array: a
  // value the store can compare between reads, and a stable dependency.
  const joined = keys.join("\n");
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const unsubscribes = (joined === "" ? [] : joined.split("\n")).map(
        (key) => store.subscribe(key as SettingKey, listener)
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [store, joined]
  );
  const read = () =>
    keys
      .filter((key) => {
        const row = store.row(key);
        return row !== undefined && test(row);
      })
      .join("\n");
  const matched = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () => (matched === "" ? [] : (matched.split("\n") as SettingKey[])),
    [matched]
  );
}
