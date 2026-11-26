import type { WrittenSettings } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import {
  documentAttributes,
  documentProperties,
  SETTINGS,
  type SettingKey,
  type SettingsValues,
} from "@workspace/settings";
import type { EffectiveSettings } from "./effective";
import {
  patchKeys,
  SettingsWriteQueue,
  type SendSettings,
  type SettingsBatch,
  type SettingsPatch,
  type SettingsWriteObserver,
  type SettingsWriteTarget,
} from "./write-queue";

/** How a store reaches the server. */
export type SettingsTransport = {
  send: SendSettings;
  /** The caller's effective settings, resolved with `projectId`'s layer when there is one. */
  read(projectId: number | null): Promise<EffectiveSettings | ActionError>;
};

/** The settings that mirror their value onto `<html>`. */
const DOCUMENT_SETTINGS = Object.values(SETTINGS).filter(
  (definition) => definition.document !== undefined
);

/**
 * Sets or removes every settings attribute and inline style property on
 * `element` to match `values`.
 */
function paintDocumentAttributes(element: HTMLElement, values: SettingsValues) {
  const attributes = documentAttributes(values, DOCUMENT_SETTINGS);
  const properties = documentProperties(values, DOCUMENT_SETTINGS);
  for (const { document } of DOCUMENT_SETTINGS) {
    if (!document) continue;
    if ("attribute" in document) {
      const value = attributes[document.attribute];
      if (value === undefined) element.removeAttribute(document.attribute);
      else if (element.getAttribute(document.attribute) !== value) {
        element.setAttribute(document.attribute, value);
      }
    } else {
      const value = properties[document.property];
      if (value === undefined) element.style.removeProperty(document.property);
      else if (element.style.getPropertyValue(document.property) !== value) {
        element.style.setProperty(document.property, value);
      }
    }
  }
}

/**
 * Whether the server resolved its answer to a write at `target` with
 * `projectId`'s layer: a project write is answered within that project, a
 * personal or an instance write with none.
 */
export const isAnsweredFor = (
  target: SettingsWriteTarget,
  projectId: number | null
) => {
  return target.scope === "project"
    ? target.id === projectId
    : projectId === null;
};

type Optimistic = { value: unknown; batch: SettingsBatch };

/**
 * One provider's settings: the server's values, what writes since have
 * confirmed, and what writes still in flight predict, in that order. The
 * server resolves every value; the store only predicts a written value where
 * the write lands at the key's highest scope, where nothing can outrank it.
 *
 * A project's store is nested in the caller's own and shares its write queue,
 * so a personal setting changed on a project page reaches both. While a nested
 * store is mounted it owns `<html>`'s attributes, and hands them back to its
 * parent when it goes.
 */
export class SettingsStore implements SettingsWriteObserver {
  readonly queue: SettingsWriteQueue;
  readonly transport: SettingsTransport;
  values: SettingsValues;

  private base: EffectiveSettings;
  private confirmed: Record<string, unknown> = {};
  private readonly optimistic = new Map<SettingKey, Optimistic>();
  private readonly listeners = new Set<() => void>();
  private attached = false;
  /** Nested stores currently owning `<html>`. */
  private claims = 0;
  private reads = 0;
  private reading = false;

  constructor(
    initial: EffectiveSettings,
    readonly projectId: number | null,
    readonly parent: SettingsStore | null,
    transport: SettingsTransport
  ) {
    this.base = initial;
    this.values = initial.values;
    this.transport = parent?.transport ?? transport;
    this.queue = parent?.queue ?? new SettingsWriteQueue(this.transport.send);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Starts listening for writes and takes over `<html>`; returns the undo. A
   * store mounted from a read that a write has since outdated (a page the
   * router cache restored on Back) reads its values again.
   */
  attach = () => {
    this.attached = true;
    const unobserve = this.queue.observe(this);
    if (this.parent) this.parent.claims++;
    this.paint();
    if (this.queue.outdated(this.projectId, this.base.version))
      void this.reread();
    else this.queue.hold(this.projectId, this.base.version);

    return () => {
      this.attached = false;
      unobserve();
      if (this.parent) {
        this.parent.claims--;
        this.parent.paint();
      }
    };
  };

  /**
   * Takes a fresh server read, unless it is the version already held. Paints
   * either way: the render that brought the read also re-rendered `<html>`
   * from the caller's own values, which a nested store has to paint over.
   */
  adopt(next: EffectiveSettings) {
    if (next.version !== this.base.version) this.replaceBase(next);
    else this.paint();
  }

  queued(batch: SettingsBatch, patch: SettingsPatch) {
    if (!this.sees(batch)) return;
    let changed = false;
    for (const key of patchKeys(patch)) {
      const value = patch[key];
      if (value !== null && SETTINGS[key].scopes[0] === batch.scope) {
        this.optimistic.set(key, { value, batch });
        changed = true;
      } else if (this.optimistic.get(key)?.batch === batch) {
        // Cleared in the same batch it was set in: nothing left to predict.
        this.optimistic.delete(key);
        changed = true;
      }
    }
    if (changed) this.update();
  }

  landed(batch: SettingsBatch, rows: WrittenSettings) {
    if (!this.sees(batch)) return;
    const answered = isAnsweredFor(batch, this.projectId);
    for (const key of patchKeys(batch.patch)) {
      const own = this.optimistic.get(key);
      const row = rows[key];
      if (answered) {
        if (row) this.confirmed[key] = row.effective;
      } else if (own?.batch === batch) {
        this.confirmed[key] = own.value;
      }
      if (own?.batch === batch) this.optimistic.delete(key);
    }
    this.update();
    // The rows were resolved without this store's project, so it reads its
    // own values again; an earlier read still in flight may predate the write.
    if (!answered || this.reading) void this.reread();
  }

  failed(batch: SettingsBatch) {
    let changed = false;
    for (const [key, entry] of this.optimistic) {
      if (entry.batch !== batch) continue;
      this.optimistic.delete(key);
      changed = true;
    }
    if (changed) this.update();
  }

  /** Whether `batch`'s scope takes part in this store's cascade. */
  private sees(batch: SettingsBatch) {
    return batch.scope !== "project" || batch.id === this.projectId;
  }

  /**
   * Reads this store's values from the server again, and every store's above
   * it: a change the write queue never saw (a lock set or lifted) can move any
   * of them. Settles once every read has answered; a read that fails leaves
   * that store's values as they were.
   */
  refresh = async (): Promise<void> => {
    this.queue.changed();
    const reads = [this.reread()];
    for (let above = this.parent; above; above = above.parent) {
      reads.push(above.reread());
    }
    await Promise.all(reads);
  };

  private async reread() {
    const read = ++this.reads;
    this.reading = true;
    const result = await this.transport
      .read(this.projectId)
      .catch((error: unknown): ActionError => ({ error: String(error) }));
    if (read !== this.reads) return;
    this.reading = false;
    if (!this.attached) return;
    if (isActionError(result)) {
      console.warn("Could not re-read settings:", result.error);
      return;
    }
    this.replaceBase(result);
  }

  private replaceBase(next: EffectiveSettings) {
    this.base = next;
    this.confirmed = {};
    this.queue.hold(this.projectId, next.version);
    this.update();
  }

  private update() {
    const values: Record<string, unknown> = {
      ...this.base.values,
      ...this.confirmed,
    };
    for (const [key, { value }] of this.optimistic) values[key] = value;
    this.values = values as SettingsValues;
    for (const listener of this.listeners) listener();
    this.paint();
  }

  private paint() {
    if (!this.attached || this.claims > 0 || typeof document === "undefined") {
      return;
    }
    paintDocumentAttributes(document.documentElement, this.values);
  }
}
