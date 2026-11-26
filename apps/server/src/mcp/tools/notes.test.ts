import { describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import * as notesQueries from "../../db/queries/notes.js";
import { activity } from "../../db/schema/activity.js";
import {
  blocksToMarkdown,
  markdownToBlocks,
} from "../../lib/markdown-blocks.js";
import { setupSuite, type Actor as TestActor } from "../../test/fixtures.js";
import { callTool, listToolNames, mintMcpToken } from "../../test/mcp.js";
import type { Actor } from "../actor.js";
import { readNotes, writeLyrics, writeNotes } from "./notes.js";

const suite = setupSuite("MCP notes tools");
const { owner, editor, viewer, outsider } = suite;

function actorFor(userId: string): Actor {
  return {
    id: userId,
    name: "",
    scopes: new Set(["read", "write"]),
    user: {} as Actor["user"],
  };
}

type ToolResult = {
  status: number;
  body: {
    result?: {
      isError?: boolean;
      content?: { type: string; text: string }[];
      structuredContent?: Record<string, unknown>;
    };
    error?: unknown;
  };
};

async function callAsActor(
  who: Pick<TestActor, "cookie">,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const token = await mintMcpToken({ cookie: who.cookie }, ["read", "write"]);
  return (await callTool(token, name, args)) as ToolResult;
}

describe("write_lyrics", () => {
  it("creates and links a note when the track has none", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Owner creates");
    const { body } = await callAsActor(owner, "write_lyrics", {
      trackId,
      markdown: "[Verse]\nFirst line",
    });
    expect(body.result?.isError).toBeUndefined();
    const content = body.result?.structuredContent as {
      markdown: string;
      noteId: number;
      version: number;
    };
    expect(content.markdown).toBe("[Verse]\nFirst line");
    expect(content.version).toBe(1);
  });

  it("lets an editor edit the owner's note", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Editor edits");
    await callAsActor(owner, "write_lyrics", {
      trackId,
      markdown: "Original",
    });
    const { body } = await callAsActor(editor, "write_lyrics", {
      trackId,
      markdown: "Edited by editor",
    });
    expect(body.result?.isError).toBeUndefined();
    const content = body.result?.structuredContent as { markdown: string };
    expect(content.markdown).toBe("Edited by editor");
  });

  it("refuses a viewer, naming the note's author", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Viewer refused");
    await callAsActor(owner, "write_lyrics", {
      trackId,
      markdown: "Original",
    });
    const { body } = await callAsActor(viewer, "write_lyrics", {
      trackId,
      markdown: "Should not land",
    });
    expect(body.result?.isError).toBe(true);
    const text = body.result?.content?.[0]?.text ?? "";
    expect(text).toContain("403");
    expect(text).toContain(owner.name);
    expect(text).toContain("unlink");
  });

  it("answers 409 and leaves the note unchanged for a stale version", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Stale version");
    const actor = actorFor(owner.userId);
    const created = await writeLyrics(actor, trackId, "Original lyrics");

    // Another writer saves between this call's read and its save, so the
    // version the call read is stale by the time it writes.
    const readNote = notesQueries.getNote;
    const getNote = spyOn(notesQueries, "getNote").mockImplementationOnce(
      async (noteId, userId) => {
        const note = await readNote(noteId, userId);
        await notesQueries.saveNote(noteId, userId, note.version, {
          body: markdownToBlocks("Written elsewhere", "lyrics"),
        });
        return note;
      }
    );
    try {
      const stale = writeLyrics(actor, trackId, "Stale writer");
      await expect(stale).rejects.toMatchObject({ status: 409 });
      await expect(stale).rejects.toThrow("changed elsewhere");
    } finally {
      getNote.mockRestore();
    }

    const note = await notesQueries.getNote(created.noteId, owner.userId);
    expect(note.version).toBe(created.version + 1);
    expect(blocksToMarkdown(note.body, "lyrics")).toBe("Written elsewhere");
  });

  it("logs the link on create-and-link, then `lyrics: edited` for the save that follows", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Activity logged");
    // The create-and-link path now logs the link itself; the edit that
    // follows is a separate row logging `lyrics: edited`.
    await callAsActor(owner, "write_lyrics", { trackId, markdown: "First" });
    await callAsActor(owner, "write_lyrics", { trackId, markdown: "Second" });

    const rows = await db
      .select()
      .from(activity)
      .where(eq(activity.entityId, trackId));
    const updates = rows.filter(
      (row) => row.entityType === "track" && row.action === "updated"
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        changes: { lyrics: { from: null, to: "linked" } },
      })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        changes: { lyrics: { from: null, to: "edited" } },
      })
    );
  });
});

describe("read_lyrics", () => {
  it("answers markdown: null for a track with no note", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("No lyrics yet");
    const { body } = await callAsActor(owner, "read_lyrics", { trackId });
    expect(body.result?.isError).toBeUndefined();
    expect(body.result?.structuredContent).toEqual({ markdown: null });
  });
});

describe("write_notes", () => {
  it("keeps a table block through the `keep` placeholder on a track", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Table keep");
    const tableBlock = {
      id: "table-1",
      type: "table",
      props: {},
      content: { type: "tableContent", rows: [] },
      children: [],
    };
    const module = await import("../../entities/index.js");
    await module.ENTITIES.track.update(trackId, { notes: [tableBlock] });

    const actor = actorFor(owner.userId);
    const before = await readNotes(actor, "track", trackId);
    expect(before.markdown).toContain("keep:table-1");

    const after = await writeNotes(
      actor,
      "track",
      trackId,
      `${before.markdown}\n\nA new paragraph`
    );
    expect(after.markdown).toContain("keep:table-1");
    expect(after.markdown).toContain("A new paragraph");

    const row = await module.ENTITIES.track.row(trackId);
    const savedBlocks = (row as unknown as { notes: unknown[] }).notes;
    expect(
      savedBlocks.some((block) => (block as { id: string }).id === "table-1")
    ).toBe(true);
  });

  it("writes a project's description, the jsonb column notes are aliased to", async () => {
    suite.requireProject();
    const actor = actorFor(owner.userId);
    const written = await writeNotes(
      actor,
      "project",
      suite.projectId,
      "# Project notes\n\nHello"
    );
    expect(written.markdown).toContain("Project notes");
    const read = await readNotes(actor, "project", suite.projectId);
    expect(read.markdown).toBe(written.markdown);
  });
});

describe("read_notes and write_notes MCP tools", () => {
  it("refuses an outsider on a foreign track's lyrics through the tool call", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Foreign to outsider");
    const { body } = await callAsActor(outsider, "read_lyrics", { trackId });
    expect(body.result?.isError).toBe(true);
  });
});

describe("list_notes", () => {
  it("shows only the actor's own notes", async () => {
    suite.requireProject();
    const { body: ownerCreate } = await callAsActor(owner, "create_note", {
      markdown: "Owner's private note",
    });
    expect(ownerCreate.result?.isError).toBeUndefined();
    await callAsActor(editor, "create_note", {
      markdown: "Editor's private note",
    });

    const { body } = await callAsActor(owner, "list_notes", {});
    expect(body.result?.isError).toBeUndefined();
    const { notes } = body.result?.structuredContent as {
      notes: { id: number; title: string }[];
    };
    const titles = notes.map((note) => note.title);
    expect(titles.some((title) => title.includes("Owner's private note"))).toBe(
      true
    );
    expect(
      titles.some((title) => title.includes("Editor's private note"))
    ).toBe(false);
  });
});

describe("read_note", () => {
  it("answers a 404 error for someone else's unlinked note, not a 403", async () => {
    suite.requireProject();
    await callAsActor(owner, "create_note", {
      markdown: "Owner's own notebook note",
    });
    const { body: list } = await callAsActor(owner, "list_notes", {});
    const { notes } = list.result?.structuredContent as {
      notes: { id: number; title: string }[];
    };
    const ownNoteId = notes.find((note) =>
      note.title.includes("Owner's own notebook note")
    )?.id;
    expect(ownNoteId).toBeDefined();

    const { body } = await callAsActor(outsider, "read_note", {
      noteId: ownNoteId,
    });
    expect(body.result?.isError).toBe(true);
    const text = body.result?.content?.[0]?.text ?? "";
    expect(text).toContain("404");
  });
});

describe("write_note", () => {
  it("round-trips a lyric with a [Chorus] section", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Write note round trip");
    const { body: created } = await callAsActor(owner, "create_note", {
      markdown: "[Verse]\nFirst line",
      trackId,
    });
    expect(created.result?.isError).toBeUndefined();

    const { body: list } = await callAsActor(owner, "list_notes", {});
    const { notes } = list.result?.structuredContent as {
      notes: { id: number; track: { id: number } | null }[];
    };
    const noteId = notes.find((note) => note.track?.id === trackId)?.id;
    expect(noteId).toBeDefined();

    const { body } = await callAsActor(owner, "write_note", {
      noteId,
      markdown: "[Chorus]\nSing it loud",
    });
    expect(body.result?.isError).toBeUndefined();
    const content = body.result?.structuredContent as { markdown: string };
    expect(content.markdown).toBe("[Chorus]\nSing it loud");

    const { body: read } = await callAsActor(owner, "read_note", { noteId });
    const readContent = read.result?.structuredContent as {
      markdown: string;
    };
    expect(readContent.markdown).toBe("[Chorus]\nSing it loud");
  });
});

describe("link_note", () => {
  it("answers 409 when the track already has a note", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Already linked");
    await callAsActor(owner, "write_lyrics", {
      trackId,
      markdown: "Existing lyrics",
    });

    const { body: created } = await callAsActor(owner, "create_note", {
      markdown: "A note looking for a home",
    });
    expect(created.result?.isError).toBeUndefined();
    const { body: list } = await callAsActor(owner, "list_notes", {});
    const { notes } = list.result?.structuredContent as {
      notes: { id: number; track: unknown }[];
    };
    const freeNoteId = notes.find((note) => note.track == null)?.id;
    expect(freeNoteId).toBeDefined();

    const { body } = await callAsActor(owner, "link_note", {
      noteId: freeNoteId,
      trackId,
    });
    expect(body.result?.isError).toBe(true);
    const text = body.result?.content?.[0]?.text ?? "";
    expect(text).toContain("409");
  });
});

describe("unlink_note and delete_note", () => {
  it("lets a project editor who is not the author unlink, but not delete", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Editor unlinks, cannot delete");
    await callAsActor(owner, "write_lyrics", {
      trackId,
      markdown: "Owner's lyrics",
    });
    const noteId = await notesQueries.noteIdForTrack(trackId);
    expect(noteId).not.toBeNull();

    const unlinked = await callAsActor(editor, "unlink_note", { noteId });
    expect(unlinked.body.result?.isError).toBeUndefined();
    expect(unlinked.body.result?.structuredContent).toEqual({ note: null });

    const relinked = await callAsActor(owner, "link_note", {
      noteId,
      trackId,
    });
    expect(relinked.body.result?.isError).toBeUndefined();

    const deleted = await callAsActor(editor, "delete_note", { noteId });
    expect(deleted.body.result?.isError).toBe(true);
    const text = deleted.body.result?.content?.[0]?.text ?? "";
    expect(text).toContain("403");
  });
});

describe("tools/list", () => {
  it("advertises the notebook tools, read-only ones on a read token", async () => {
    const writeToken = await mintMcpToken({ cookie: owner.cookie }, [
      "read",
      "write",
    ]);
    const writeNames = await listToolNames(writeToken);
    for (const name of [
      "list_notes",
      "read_note",
      "write_note",
      "create_note",
      "link_note",
      "unlink_note",
      "delete_note",
    ]) {
      expect(writeNames).toContain(name);
    }

    const readToken = await mintMcpToken({ cookie: owner.cookie }, ["read"]);
    const readNames = await listToolNames(readToken);
    expect(readNames).toContain("list_notes");
    expect(readNames).toContain("read_note");
    expect(readNames).not.toContain("write_note");
    expect(readNames).not.toContain("create_note");
  });
});
