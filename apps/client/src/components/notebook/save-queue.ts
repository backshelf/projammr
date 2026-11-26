import type { NewNote, NoteDetail, NotePatch } from "@workspace/api/api";

export type SaveState =
  "draft" | "saved" | "unsaved" | "saving" | "conflict" | "error";

type Identity = { id: number; version: number } | null;

/** A note edit without the version, which the queue supplies from its identity. */
export type NoteEdit = Omit<NotePatch, "version">;

/**
 * openapi-fetch's raw result, which `lib/notes-client.ts` returns unwrapped so
 * the status of a failure is still readable here.
 */
export type Result<T> = { data?: T; error?: unknown; response: Response };

export type Deps = {
  create: (input: NewNote) => Promise<Result<NoteDetail>>;
  save: (
    id: number,
    version: number,
    patch: NoteEdit
  ) => Promise<Result<NoteDetail>>;
  onSaved: (note: NoteDetail, created: boolean) => void;
  onState: (state: SaveState) => void;
};

/** Later edits win, and either side may be absent. */
const merge = (base: NoteEdit | null, over: NoteEdit | null): NoteEdit => ({
  ...base,
  ...over,
});

/** What a draft starts as: the track it will be linked to, the mode it opens in. */
export type Draft = { trackId?: number; lyricsMode?: boolean };

/**
 * Serialises saves: at most one request in flight, and a change that lands
 * while one is out marks the queue dirty so a second save follows. Until the
 * row exists the first flush is a create carrying whatever has been typed so
 * far — later changes wait behind it, since they need its id — and after it
 * every flush is a patch presenting the version the server last answered
 * with. An older version would be refused as stale, which is the conflict
 * this guards, not a bug in it.
 */
export function createSaveQueue(initial: Identity, draft: Draft, deps: Deps) {
  let identity = initial;
  let dirty: NoteEdit | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: SaveState = initial ? "saved" : "draft";

  const set = (next: SaveState) => {
    state = next;
    deps.onState(next);
  };

  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    const patch = dirty;
    if (!patch) return Promise.resolve();
    // A draft with nothing typed yet is not a note: only content creates one.
    if (!identity && !patch.body) return Promise.resolve();
    dirty = null;
    set("saving");
    inFlight = (async () => {
      const res = identity
        ? await deps.save(identity.id, identity.version, patch)
        : await deps.create({
            trackId: draft.trackId,
            body: patch.body!,
            lyricsMode: patch.lyricsMode ?? draft.lyricsMode,
          });
      const created = !identity;
      inFlight = null;
      if (res.data) {
        identity = { id: res.data.id, version: res.data.version };
        deps.onSaved(res.data, created);
        set(dirty ? "unsaved" : "saved");
        // Awaited, so a caller waiting on this flush is waiting on the whole
        // burst, not just its first request.
        if (dirty) await flush();
      } else if (res.response.status === 409) {
        dirty = null;
        set("conflict"); // the editor locks until the user reloads
      } else {
        dirty = merge(patch, dirty); // keep the edit; retry on the next change
        set("error");
      }
    })();
    return inFlight;
  };

  const queue = (patch: NoteEdit, delayMs: number) => {
    dirty = merge(dirty, patch);
    if (state !== "saving") set("unsaved");
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  };

  /** Sends whatever is pending now, rather than when the debounce would have. */
  const settle = () => {
    clearTimeout(timer);
    return flush();
  };

  return {
    queue,
    flush,
    settle,
    get identity() {
      return identity;
    },
    get state() {
      return state;
    },
  };
}
