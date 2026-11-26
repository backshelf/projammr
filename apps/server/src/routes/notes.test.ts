import { describe, expect, it } from "bun:test";
import { setupSuite } from "../test/fixtures.js";

/**
 * `/notes` is mounted auth-only, like `/me` — a note's author keeps it
 * whether or not it is linked into the suite's project, so `expectAccess`
 * (which asserts every endpoint 403s a signed-in non-member) does not apply
 * here: an outsider's own notebook answers 200, and a note they did not
 * write and cannot see through a project answers 404, never 403.
 */
const suite = setupSuite("Notes");
const { owner, request, mkTrack, requireProject } = suite;

const paragraph = (text: string) => ({
  type: "paragraph",
  content: text === "" ? [] : [{ type: "text", text }],
});
const heading = (text: string) => ({
  type: "heading",
  content: [{ type: "text", text }],
});
const doc = (...lines: string[]) => lines.map(paragraph);

type Writer = "owner" | "editor" | "viewer";

async function createNote(caller: Writer, body: unknown[], trackId?: number) {
  const payload: Record<string, unknown> = { body };
  if (trackId != null) payload.trackId = trackId;
  const res = await request(caller, "/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function trackActivity(trackId: number) {
  const res = await request(
    "owner",
    `/projects/${suite.projectId}/activity?entityType=track&entityId=${trackId}`
  );
  expect(res.status).toBe(200);
  return res.json();
}

describe("authentication", () => {
  it("rejects an anonymous caller on every route", async () => {
    const cases: [string, string, RequestInit?][] = [
      ["GET", "/notes"],
      ["POST", "/notes", { body: JSON.stringify({ body: doc("x") }) }],
      ["GET", "/notes/1"],
      ["GET", "/notes/1/text"],
      ["PATCH", "/notes/1", { body: JSON.stringify({ version: 1 }) }],
      ["POST", "/notes/1/link", { body: JSON.stringify({ trackId: 1 }) }],
      ["POST", "/notes/1/unlink"],
      ["DELETE", "/notes/1"],
    ];

    for (const [method, path, init] of cases) {
      const res = await request("anonymous", path, { method, ...init });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("GET /notes", () => {
  it("returns the caller's own notes", async () => {
    const note = await createNote("owner", doc("Listed"));
    const res = await request("owner", "/notes");
    expect(res.status).toBe(200);

    const list = (await res.json()) as { id: number }[];
    expect(list.map((n) => n.id)).toContain(note.id);
  });
});

describe("POST /notes", () => {
  it("creates an unlinked note the author alone may read and write", async () => {
    const note = await createNote("owner", doc("Fresh"));
    expect(note.title).toBe("Fresh");
    expect(note.track).toBeNull();
    expect(note.can).toEqual({ write: true, unlink: false, delete: true });
  });

  it("rejects a request with no body field", async () => {
    const res = await request("owner", "/notes", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("titles a note from its first written block, even a heading", async () => {
    const note = await createNote("owner", [
      heading("Verse One"),
      ...doc("second line"),
    ]);
    expect(note.title).toBe("Verse One");
  });

  it("links immediately when a track is named, and logs it as the track's lyrics", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Create-Linked");
    const note = await createNote("owner", doc("Attached"), trackId);
    expect(note.track).toMatchObject({
      id: trackId,
      projectId: suite.projectId,
    });

    const feed = await trackActivity(trackId);
    const updated = feed.find(
      (row: { action: string }) => row.action === "updated"
    );
    expect(updated.changes.lyrics).toEqual({ from: null, to: "linked" });
  });
});

describe("GET /notes/:id", () => {
  it("gets a note by id", async () => {
    const note = await createNote("owner", doc("Read me"));
    const res = await request("owner", `/notes/${note.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(note.id);
  });

  it("hides an unlinked note from a caller who did not write it", async () => {
    const note = await createNote("owner", doc("Private"));
    const res = await request("outsider", `/notes/${note.id}`);
    expect(res.status).toBe(404);
  });

  it("lets a project viewer read a linked note", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Viewable");
    const note = await createNote("owner", doc("Shared"), trackId);
    const res = await request("viewer", `/notes/${note.id}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /notes/:id/text", () => {
  it("joins the note's written lines with newlines", async () => {
    const note = await createNote("owner", doc("First", "Second"));
    const res = await request("owner", `/notes/${note.id}/text`);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("First\nSecond");
  });

  it("answers 404 for a note the caller may not read", async () => {
    const note = await createNote("owner", doc("Hidden"));
    const res = await request("outsider", `/notes/${note.id}/text`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /notes/:id", () => {
  it("lets the author save changes", async () => {
    const note = await createNote("owner", doc("Draft"));
    const res = await request("owner", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: note.version, body: doc("Final") }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Final");
  });

  it("logs a linked note's body edit as lyrics: edited, carrying no body", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Lyrics Edit");
    const note = await createNote("owner", doc("Verse one"), trackId);

    const res = await request("owner", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: note.version, body: doc("Verse two") }),
    });
    expect(res.status).toBe(200);

    const feed = await trackActivity(trackId);
    const edited = feed.find(
      (row: { changes: { lyrics?: { to: unknown } } | null }) =>
        row.changes?.lyrics?.to === "edited"
    );
    expect(edited).toBeTruthy();
    expect(JSON.stringify(edited.changes)).not.toContain("Verse two");
  });

  it("lets a project editor write a linked note", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Editable");
    const note = await createNote("owner", doc("Shared"), trackId);
    const res = await request("editor", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version: note.version,
        body: doc("Edited by the editor"),
      }),
    });
    expect(res.status).toBe(200);
  });

  it("refuses a project viewer's write", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Guarded");
    const note = await createNote("owner", doc("Shared"), trackId);
    const res = await request("viewer", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: note.version, body: doc("Meddling") }),
    });
    expect(res.status).toBe(403);
  });

  it("answers 409 in the shared error envelope for a stale version", async () => {
    const note = await createNote("owner", doc("Original"));
    await request("owner", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: note.version, body: doc("Winner") }),
    });

    const res = await request("owner", `/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: note.version, body: doc("Loser") }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /notes/:id/link", () => {
  it("links a note the caller wrote and logs it on the track", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook To Link");
    const note = await createNote("owner", doc("Give me a home"));

    const res = await request("owner", `/notes/${note.id}/link`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).track).toMatchObject({ id: trackId });

    const feed = await trackActivity(trackId);
    const updated = feed.find(
      (row: { action: string }) => row.action === "updated"
    );
    expect(updated.changes.lyrics).toEqual({ from: null, to: "linked" });
  });

  it("refuses a link attempt from a caller who did not write the note", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Already Linked");
    const note = await createNote("owner", doc("Shared"), trackId);
    const elsewhere = await mkTrack("Notebook Elsewhere");

    const res = await request("editor", `/notes/${note.id}/link`, {
      method: "POST",
      body: JSON.stringify({ trackId: elsewhere }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /notes/:id/unlink", () => {
  it("returns a linked note to the author's notebook and logs the change", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook To Unlink");
    const note = await createNote("owner", doc("Linked"), trackId);

    const res = await request("owner", `/notes/${note.id}/unlink`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).track).toBeNull();

    const feed = await trackActivity(trackId);
    const updated = feed.find(
      (row: { changes: { lyrics?: { to: unknown } } | null }) =>
        row.changes?.lyrics?.to === null
    );
    expect(updated).toBeTruthy();
  });
});

describe("POST /notes/:id/unlink as a project editor", () => {
  it("unlinks someone else's note and answers null, not the note it can no longer read", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Editor Unlink");
    const note = await createNote("owner", doc("Owner's lyrics"), trackId);

    const res = await request("editor", `/notes/${note.id}/unlink`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();

    const hidden = await request("editor", `/notes/${note.id}`);
    expect(hidden.status).toBe(404);
  });
});

describe("DELETE /notes/:id", () => {
  it("lets the author delete their note", async () => {
    const note = await createNote("owner", doc("Doomed"));
    const res = await request("owner", `/notes/${note.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    const gone = await request("owner", `/notes/${note.id}`);
    expect(gone.status).toBe(404);
  });

  it("refuses an editor who is not the author, even one who may write it", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Guarded Delete");
    const note = await createNote("owner", doc("Shared"), trackId);

    const res = await request("editor", `/notes/${note.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /tracks/:id", () => {
  it("carries the linked note and drops it again once unlinked", async () => {
    requireProject();
    const trackId = await mkTrack("Notebook Note Carrier");
    const note = await createNote("owner", doc("Carried"), trackId);

    const linked = await (await request("owner", `/tracks/${trackId}`)).json();
    expect(linked.note).toMatchObject({
      id: note.id,
      authorId: owner.userId,
      lyricsMode: true,
    });

    await request("owner", `/notes/${note.id}/unlink`, { method: "POST" });
    const unlinked = await (
      await request("owner", `/tracks/${trackId}`)
    ).json();
    expect(unlinked.note).toBeNull();
  });
});
