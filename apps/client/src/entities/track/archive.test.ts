import { beforeEach, describe, expect, it, mock } from "bun:test";

type Call = { path: string; init: { body: unknown } };
type Answer = { ids: number[]; sessionCount: number };

const calls: Call[] = [];
let answers: Array<Answer | "fail"> = [];

const post = (path: string, init: { body: unknown }) => {
  calls.push({ path, init });
  const answer = answers.shift() ?? { ids: [], sessionCount: 0 };
  if (answer === "fail") {
    return Promise.resolve({
      error: { error: "Nope" },
      response: new Response(JSON.stringify({ error: "Nope" }), {
        status: 500,
      }),
    });
  }
  return Promise.resolve({
    data: answer,
    response: new Response(JSON.stringify(answer), { status: 200 }),
  });
};

mock.module("@/lib/browser-api", () => ({ browserApi: { POST: post } }));

const { archiveTracks, unarchiveTracks } = await import("./archive");

const refresh = mock(() => {});
const base = {
  projectId: 7,
  selection: { ids: [1, 2, 3] },
  router: { refresh },
};

beforeEach(() => {
  calls.length = 0;
  answers = [];
  refresh.mockClear();
});

async function messageOf(promise: Promise<{ ok: boolean; message: string }>) {
  return (await promise).message;
}

describe("archiveTracks", () => {
  it("names the track and its sessions when one track changed", async () => {
    answers = [{ ids: [1], sessionCount: 3 }];
    expect(await messageOf(archiveTracks({ ...base, title: "Demo" }))).toBe(
      "Archived Demo and its 3 sessions"
    );
  });

  it("says 'its session' for exactly one session", async () => {
    answers = [{ ids: [1], sessionCount: 1 }];
    expect(await messageOf(archiveTracks({ ...base, title: "Demo" }))).toBe(
      "Archived Demo and its session"
    );
  });

  it("leaves sessions out when the track has none", async () => {
    answers = [{ ids: [1], sessionCount: 0 }];
    expect(await messageOf(archiveTracks({ ...base, title: "Demo" }))).toBe(
      "Archived Demo"
    );
  });

  it("uses the count copy without a title", async () => {
    answers = [{ ids: [1], sessionCount: 2 }];
    expect(await messageOf(archiveTracks(base))).toBe("Archived 1 track");
  });

  it("uses the count copy when a title is given but several changed", async () => {
    answers = [{ ids: [1, 2], sessionCount: 2 }];
    expect(await messageOf(archiveTracks({ ...base, title: "Demo" }))).toBe(
      "Archived 2 tracks"
    );
  });

  it("posts the selection to the archive route and refreshes the route", async () => {
    answers = [{ ids: [1], sessionCount: 0 }];
    await archiveTracks(base);
    expect(calls).toEqual([
      {
        path: "/api/tracks/bulk/archive",
        init: { body: { projectId: 7, selection: { ids: [1, 2, 3] } } },
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("offers no undo when nothing changed", async () => {
    answers = [{ ids: [], sessionCount: 0 }];
    const result = await archiveTracks(base);
    expect(result).toEqual({ ok: true, message: "No tracks to archive" });
  });

  it("undoes exactly the ids the server answered, with the same title", async () => {
    answers = [
      { ids: [2, 3], sessionCount: 4 },
      { ids: [2, 3], sessionCount: 4 },
    ];
    const result = await archiveTracks({ ...base, title: "Demo" });
    if (!result.ok || !result.undo) throw new Error("expected an undo");

    const undone = await result.undo();
    expect(calls[1]).toEqual({
      path: "/api/tracks/bulk/unarchive",
      init: { body: { projectId: 7, selection: { ids: [2, 3] } } },
    });
    expect(undone.ok && undone.message).toBe("Unarchived 2 tracks");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reports a failed request as ok: false and does not refresh", async () => {
    answers = ["fail"];
    const result = await archiveTracks(base);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Nope");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("unarchiveTracks", () => {
  it("names the track when one changed", async () => {
    answers = [{ ids: [1], sessionCount: 5 }];
    expect(await messageOf(unarchiveTracks({ ...base, title: "Demo" }))).toBe(
      "Unarchived Demo"
    );
  });

  it("uses the count copy when several changed, even with a title", async () => {
    answers = [{ ids: [1, 2], sessionCount: 0 }];
    expect(await messageOf(unarchiveTracks({ ...base, title: "Demo" }))).toBe(
      "Unarchived 2 tracks"
    );
  });

  it("offers no undo when nothing changed", async () => {
    answers = [{ ids: [], sessionCount: 0 }];
    expect(await unarchiveTracks(base)).toEqual({
      ok: true,
      message: "No tracks to unarchive",
    });
  });

  it("undoes by archiving exactly the answered ids", async () => {
    answers = [
      { ids: [3], sessionCount: 0 },
      { ids: [3], sessionCount: 2 },
    ];
    const result = await unarchiveTracks({ ...base, title: "Demo" });
    if (!result.ok || !result.undo) throw new Error("expected an undo");

    const undone = await result.undo();
    expect(calls[1]).toEqual({
      path: "/api/tracks/bulk/archive",
      init: { body: { projectId: 7, selection: { ids: [3] } } },
    });
    expect(undone.ok && undone.message).toBe(
      "Archived Demo and its 2 sessions"
    );
  });

  it("reports a failed request as ok: false", async () => {
    answers = ["fail"];
    const result = await unarchiveTracks(base);
    expect(result).toEqual({ ok: false, message: "Nope" });
  });
});
