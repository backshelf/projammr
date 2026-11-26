import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  jest,
} from "bun:test";
import type { NoteDetail } from "@workspace/api/api";
import { createSaveQueue, type Deps, type Result } from "./save-queue";

const body = (text: string) => [
  { type: "paragraph", content: [{ type: "text", text }] },
];

const note = (id: number, version: number) => ({ id, version }) as NoteDetail;

const ok = (detail: NoteDetail): Result<NoteDetail> => ({
  data: detail,
  response: new Response(null, { status: 200 }),
});

const failed = (status: number): Result<NoteDetail> => ({
  error: { error: "nope" },
  response: new Response(null, { status }),
});

/** A promise whose resolution the test drives, standing in for a request. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeDeps() {
  return {
    create: mock<Deps["create"]>(),
    save: mock<Deps["save"]>(),
    onSaved: mock<Deps["onSaved"]>(),
    onState: mock<Deps["onState"]>(),
  };
}

describe("createSaveQueue", () => {
  // The debounce timer is never what a test is exercising — every case drives
  // the queue through `flush` directly — so freezing time keeps a queued
  // change from firing a second, unasked-for save mid-assertion.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("creates the note on a draft's first flush, carrying the draft's track", async () => {
    const deps = makeDeps();
    deps.create.mockResolvedValue(ok(note(5, 1)));
    const queue = createSaveQueue(null, { trackId: 7 }, deps);

    queue.queue({ body: body("verse") }, 0);
    await queue.flush();

    expect(deps.create).toHaveBeenCalledWith({
      trackId: 7,
      body: body("verse"),
      lyricsMode: undefined,
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(queue.identity).toEqual({ id: 5, version: 1 });
    expect(queue.state).toBe("saved");
  });

  it("saves a change made during the create against the created note", async () => {
    const deps = makeDeps();
    const creating = deferred<Result<NoteDetail>>();
    deps.create.mockReturnValue(creating.promise);
    deps.save.mockResolvedValue(ok(note(5, 2)));
    const queue = createSaveQueue(null, {}, deps);

    queue.queue({ body: body("first") }, 0);
    const created = queue.flush();
    queue.queue({ body: body("second") }, 0);
    creating.resolve(ok(note(5, 1)));
    await created;

    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.save).toHaveBeenCalledWith(5, 1, { body: body("second") });
  });

  it("creates in the mode the draft opened in unless the user changed it", async () => {
    const deps = makeDeps();
    deps.create.mockResolvedValue(ok(note(5, 1)));
    const queue = createSaveQueue(null, { lyricsMode: true }, deps);

    queue.queue({ body: body("verse") }, 0);
    await queue.flush();

    expect(deps.create).toHaveBeenCalledWith({
      trackId: undefined,
      body: body("verse"),
      lyricsMode: true,
    });
  });

  it("creates nothing for a draft that only toggles lyrics mode", async () => {
    const deps = makeDeps();
    const queue = createSaveQueue(null, {}, deps);

    queue.queue({ lyricsMode: true }, 0);
    await queue.flush();

    expect(deps.create).not.toHaveBeenCalled();
    expect(queue.identity).toBeNull();
  });

  it("follows an in-flight save with exactly one more, however many changes land", async () => {
    const deps = makeDeps();
    const saving = deferred<Result<NoteDetail>>();
    deps.save.mockReturnValueOnce(saving.promise);
    deps.save.mockResolvedValue(ok(note(5, 3)));
    const queue = createSaveQueue({ id: 5, version: 1 }, {}, deps);

    queue.queue({ body: body("one") }, 0);
    const first = queue.flush();
    queue.queue({ body: body("two") }, 0);
    queue.queue({ body: body("three") }, 0);
    saving.resolve(ok(note(5, 2)));
    await first;

    expect(deps.save).toHaveBeenCalledTimes(2);
    // The follow-up presents the version the first save answered with; an
    // older one would come back 409.
    expect(deps.save).toHaveBeenLastCalledWith(5, 2, { body: body("three") });
  });

  it("locks on a 409 and drops the patch waiting behind it", async () => {
    const deps = makeDeps();
    const saving = deferred<Result<NoteDetail>>();
    deps.save.mockReturnValueOnce(saving.promise);
    const queue = createSaveQueue({ id: 5, version: 1 }, {}, deps);

    queue.queue({ body: body("one") }, 0);
    const first = queue.flush();
    queue.queue({ body: body("two") }, 0);
    saving.resolve(failed(409));
    await first;

    expect(queue.state).toBe("conflict");
    await queue.flush();
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it("keeps the edit after a failed save and retries it on the next change", async () => {
    const deps = makeDeps();
    deps.save.mockResolvedValueOnce(failed(500));
    deps.save.mockResolvedValue(ok(note(5, 2)));
    const queue = createSaveQueue({ id: 5, version: 1 }, {}, deps);

    queue.queue({ body: body("one") }, 0);
    await queue.flush();
    expect(queue.state).toBe("error");

    queue.queue({ lyricsMode: true }, 0);
    await queue.flush();

    expect(deps.save).toHaveBeenLastCalledWith(5, 1, {
      body: body("one"),
      lyricsMode: true,
    });
    expect(queue.state).toBe("saved");
  });
});
