import type { WrittenSettings } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import {
  isSettingKey,
  type SettingKey,
  type SettingsValues,
} from "@workspace/settings";

/**
 * A change to settings at one scope: a value per key, or `null` to clear the
 * key there so it inherits again.
 */
export type SettingsPatch = {
  readonly [K in SettingKey]?: SettingsValues[K] | null;
};

/**
 * The id each scope's writes name: the caller's own user id, a project's id,
 * or the instance.
 */
type WriteIds = {
  user: string;
  project: number;
  instance: "instance";
};

/** A scope the client writes settings at. */
export type SettingsWriteScope = keyof WriteIds;

/** Where a write lands: one scope and the id it names there. */
export type SettingsWriteTarget = {
  [S in SettingsWriteScope]: { readonly scope: S; readonly id: WriteIds[S] };
}[SettingsWriteScope];

/** The writes to one target that go to the server as one request. */
export type SettingsBatch = SettingsWriteTarget & {
  readonly patch: SettingsPatch;
};

/**
 * Writes settings: applied to every provider at once, sent after the writes
 * settle, and settling once the server has answered, with the hub's view of
 * every key in the request that carried it. Rejects with a
 * `SettingsWriteError` once the values from before it are back.
 */
export type SettingsWriteFn = <S extends SettingsWriteScope>(
  scope: S,
  id: WriteIds[S],
  patch: SettingsPatch
) => Promise<WrittenSettings>;

/** What a settings provider hears about each batch. */
export interface SettingsWriteObserver {
  /** `patch` joined `batch`, before anything was sent. */
  queued(batch: SettingsBatch, patch: SettingsPatch): void;
  /** The server stored `batch` and answered with the rows it changed. */
  landed(batch: SettingsBatch, rows: WrittenSettings): void;
  /** The server refused `batch`; nothing in it was stored. */
  failed(batch: SettingsBatch): void;
}

export type SendSettings = (
  target: SettingsWriteTarget,
  patch: SettingsPatch
) => Promise<WrittenSettings | ActionError>;

/** A refused settings write, carrying the API's code and details (`setting_locked` names the lock). */
export class SettingsWriteError extends Error {
  override readonly name = "SettingsWriteError";
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    failure: ActionError,
    /** Every key in the refused request, the caller's and any written beside it. */
    readonly keys: readonly SettingKey[]
  ) {
    super(failure.error);
    this.status = failure.status;
    this.code = failure.code;
    this.details = failure.details;
  }
}

/** How long a target's writes wait for the next one before going out: a dragged slider writes on every move. */
const SETTINGS_WRITE_DELAY_MS = 300;

/** The keys a patch sets or clears; an `undefined` value is no change. */
export const patchKeys = (patch: SettingsPatch): SettingKey[] =>
  Object.keys(patch).filter(
    (key): key is SettingKey =>
      isSettingKey(key) && patch[key as SettingKey] !== undefined
  );

type Open = {
  batch: SettingsBatch;
  /** `batch.patch`, which only the queue writes to. */
  patch: Record<string, unknown>;
  timer?: ReturnType<typeof setTimeout>;
  settled: Promise<WrittenSettings>;
  resolve: (rows: WrittenSettings) => void;
  reject: (error: SettingsWriteError) => void;
};

const unreachable = (error: unknown): ActionError => ({
  error: error instanceof Error ? error.message : "Network error",
});

/**
 * Coalesces settings writes per target. Writes to one scope and id within
 * `delayMs` of each other go as one request, the last value per key winning;
 * a target's requests go one at a time, in order, so a later value never
 * lands before an earlier one.
 */
export class SettingsWriteQueue {
  private readonly open = new Map<string, Open>();
  private readonly tails = new Map<string, Promise<void>>();
  private sending = 0;
  private readonly observers = new Set<SettingsWriteObserver>();
  private readonly pendingListeners = new Set<() => void>();
  /** How many changes have landed: each one may move any store's values. */
  private landings = 0;
  /**
   * The landing count each effective read was last current at, by project and
   * version: a version digests the values alone, so two projects' reads can
   * share one.
   */
  private readonly versions = new Map<string, number>();
  /**
   * The landing count each hub read object was last current at. The hub's
   * read carries no version to key `versions` with, but the router cache
   * hands back the very same object on a restored mount, so its identity
   * serves in place of one.
   */
  private readonly reads = new WeakMap<object, number>();

  constructor(
    private readonly send: SendSettings,
    private readonly delayMs = SETTINGS_WRITE_DELAY_MS
  ) {}

  /** Whether a write is waiting to go out or waiting for its answer. */
  get pending(): boolean {
    return this.open.size > 0 || this.sending > 0;
  }

  subscribePending = (listener: () => void) => {
    this.pendingListeners.add(listener);
    return () => {
      this.pendingListeners.delete(listener);
    };
  };

  observe(observer: SettingsWriteObserver) {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  /** Records that a store holds `projectId`'s effective read `version`, current as of now. */
  hold(projectId: number | null, version: string) {
    this.versions.set(`${projectId}:${version}`, this.landings);
  }

  /**
   * Whether `projectId`'s read `version` was held before a change that has
   * landed since: a read the router cache handed back on Back or Forward,
   * from before the change. A read never held is a fresh one, and current.
   */
  outdated(projectId: number | null, version: string): boolean {
    const heldAt = this.versions.get(`${projectId}:${version}`);
    return heldAt !== undefined && heldAt < this.landings;
  }

  /** Counts a change made outside the queue (an import, a lock), so every read held before it is outdated. */
  changed() {
    this.landings++;
  }

  /** Records that `read` (a mounted hub payload) is current as of now. */
  holdRead(read: object) {
    this.reads.set(read, this.landings);
  }

  /**
   * Whether `read` was held before a change that has landed since: the same
   * object the router cache handed back on a restored mount, from before the
   * change. A read never held is a fresh one, and current.
   */
  outdatedRead(read: object): boolean {
    const heldAt = this.reads.get(read);
    return heldAt !== undefined && heldAt < this.landings;
  }

  write: SettingsWriteFn = (scope, id, patch) => {
    const keys = patchKeys(patch);
    const target = `${scope}:${id}`;
    const existing = this.open.get(target);
    if (keys.length === 0) return existing?.settled ?? Promise.resolve({});

    const wasPending = this.pending;
    const entry =
      existing ?? this.openBatch({ scope, id } as SettingsWriteTarget, target);
    const change: Record<string, unknown> = {};
    for (const key of keys) change[key] = entry.patch[key] = patch[key];

    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.flush(target), this.delayMs);

    for (const observer of this.observers) {
      observer.queued(entry.batch, change as SettingsPatch);
    }
    if (!wasPending) this.notifyPending();
    return entry.settled;
  };

  private openBatch(target: SettingsWriteTarget, key: string): Open {
    let resolve!: (rows: WrittenSettings) => void;
    let reject!: (error: SettingsWriteError) => void;
    const settled = new Promise<WrittenSettings>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const patch: Record<string, unknown> = {};
    const entry: Open = {
      batch: { ...target, patch: patch as SettingsPatch },
      patch,
      settled,
      resolve,
      reject,
    };
    this.open.set(key, entry);
    return entry;
  }

  private flush(target: string) {
    const entry = this.open.get(target);
    if (!entry) return;
    this.open.delete(target);
    this.sending++;

    const previous = this.tails.get(target) ?? Promise.resolve();
    const sent = previous
      .then(() => this.deliver(entry))
      // A provider that throws on an answer must not hold up every later
      // write to the target behind a rejected tail.
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        if (this.tails.get(target) === sent) this.tails.delete(target);
        this.sending--;
        this.notifyPending();
      });
    this.tails.set(target, sent);
  }

  /** Sends one batch and tells the providers before the writers hear, so a rejection finds the old values back. */
  private async deliver({ batch, resolve, reject }: Open) {
    const result = await this.send(batch, batch.patch).catch(unreachable);

    if (isActionError(result)) {
      for (const observer of this.observers) observer.failed(batch);
      reject(new SettingsWriteError(result, patchKeys(batch.patch)));
      return;
    }
    this.landings++;
    for (const observer of this.observers) observer.landed(batch, result);
    resolve(result);
  }

  private notifyPending() {
    for (const listener of this.pendingListeners) listener();
  }
}
