import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { BlockDocument } from "../../db/schema/base.js";
import { rawEntityKindEnum } from "../../db/schema/enums.js";
import {
  createNote,
  deleteNote,
  getNote,
  linkNote,
  listNotes,
  noteIdForTrack,
  noteRightsSchema,
  noteSummarySchema,
  saveNote,
  trackRefSchema,
  unlinkNote,
  type NoteDetail,
  type NoteRights,
  type NoteSummary,
} from "../../db/queries/notes.js";
import { ENTITIES, type EntityKind } from "../../entities/index.js";
import {
  blocksToMarkdown,
  markdownToBlocks,
} from "../../lib/markdown-blocks.js";
import { activityContext, type Actor } from "../actor.js";
import { logLinkChange } from "../../routes/activity-log.js";
import { requireEntity } from "../authorize.js";
import { patchEntityAs } from "../entity-writes.js";
import { defineTool } from "../spec.js";

const entityKindSchema = z.enum(rawEntityKindEnum);

/** The block document field a module's notes/description live on. */
function notesField(kind: EntityKind): "notes" | "description" {
  return ENTITIES[kind].notesField ?? "notes";
}

function docOf(row: unknown, field: "notes" | "description"): BlockDocument {
  return (
    ((row as Record<string, unknown>)[field] as BlockDocument | null) ?? []
  );
}

/**
 * One entity's notes (a project's `description`, everything else's `notes`)
 * as markdown. Gated at viewer, the same as reading the entity itself.
 */
export async function readNotes(
  actor: Actor,
  kind: EntityKind,
  id: number
): Promise<{ markdown: string }> {
  await requireEntity(actor, kind, id, "viewer");
  const module = ENTITIES[kind];
  const row = await module.row(id);
  if (!row)
    throw new HTTPException(404, { message: `${module.label} not found` });
  return {
    markdown: blocksToMarkdown(docOf(row, notesField(kind)), "document"),
  };
}

/**
 * Replaces one entity's notes from markdown, keeping whatever the markdown
 * cannot express through the `keep` placeholder against the stored document.
 * Gated at editor, the same as any other patch.
 */
export async function writeNotes(
  actor: Actor,
  kind: EntityKind,
  id: number,
  markdown: string
): Promise<{ markdown: string }> {
  const gate = await requireEntity(actor, kind, id, "editor");
  const module = ENTITIES[kind];
  const existing = await module.row(id);
  if (!existing)
    throw new HTTPException(404, { message: `${module.label} not found` });
  const field = notesField(kind);
  const blocks = markdownToBlocks(markdown, "document", docOf(existing, field));
  const after = await patchEntityAs(actor, module, gate.projectId, id, {
    [field]: blocks,
  });
  return { markdown: blocksToMarkdown(docOf(after, field), "document") };
}

export type LyricsRead = {
  markdown: string | null;
  noteId?: number;
  version?: number;
  can?: NoteRights;
};

/**
 * A track's lyrics as markdown, in lyrics mode. `markdown: null` covers both
 * "no note" and "a note the actor may not read" — the two cases must look
 * the same, or the id would leak which of them it is.
 */
export async function readLyrics(
  actor: Actor,
  trackId: number
): Promise<LyricsRead> {
  await requireEntity(actor, "track", trackId, "viewer");
  const noteId = await noteIdForTrack(trackId);
  if (noteId == null) return { markdown: null };
  try {
    const note = await getNote(noteId, actor.id);
    return {
      markdown: blocksToMarkdown(note.body, "lyrics"),
      noteId,
      version: note.version,
      can: note.can,
    };
  } catch (err) {
    if (err instanceof HTTPException && err.status === 404) {
      return { markdown: null };
    }
    throw err;
  }
}

export type LyricsWrite = { markdown: string; noteId: number; version: number };

/**
 * Runs a note save, rewording the query layer's generic 409 into the
 * subject-specific "changed elsewhere" text every write-a-note tool answers
 * with, without retrying — the caller reads again and decides. Shared by
 * `writeLyrics` and `writeNote` so the wording lives in one place.
 */
async function saveOrExplainStale<T>(
  subject: string,
  save: () => Promise<T>
): Promise<T> {
  try {
    return await save();
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      throw new HTTPException(409, {
        message: `${subject} changed elsewhere; read again before writing.`,
      });
    }
    throw err;
  }
}

/**
 * Writes a track's lyrics: creates and links a note where there is none,
 * saves over a note the actor may write, and refuses — naming the author —
 * a note someone else holds. A stale version answers 409 without retrying;
 * the caller reads again and decides.
 */
export async function writeLyrics(
  actor: Actor,
  trackId: number,
  markdown: string
): Promise<LyricsWrite> {
  await requireEntity(actor, "track", trackId, "viewer");
  const noteId = await noteIdForTrack(trackId);

  if (noteId == null) {
    const blocks = markdownToBlocks(markdown, "lyrics");
    const note = await createNote(actor.id, { trackId, body: blocks });
    if (note.track) {
      await logLinkChange(
        activityContext(actor),
        { projectId: note.track.projectId, trackId: note.track.id },
        "linked"
      );
    }
    return {
      markdown: blocksToMarkdown(note.body, "lyrics"),
      noteId: note.id,
      version: note.version,
    };
  }

  const note = await getNote(noteId, actor.id);
  if (!note.can.write) {
    throw new HTTPException(403, {
      message:
        `This track's lyrics belong to ${note.author.name}; ` +
        "an editor may unlink them but not overwrite them.",
    });
  }

  const blocks = markdownToBlocks(markdown, "lyrics", note.body);
  const saved = await saveOrExplainStale("This track's lyrics", () =>
    saveNote(noteId, actor.id, note.version, { body: blocks })
  );
  return {
    markdown: blocksToMarkdown(saved.body, "lyrics"),
    noteId: saved.id,
    version: saved.version,
  };
}

/** The shape every notebook tool that leaves a note readable answers with. */
export type NoteState = z.infer<typeof noteStateOutput>;

function noteMode(note: Pick<NoteDetail, "lyricsMode">): "lyrics" | "document" {
  return note.lyricsMode ? "lyrics" : "document";
}

function noteStateOf(note: NoteDetail): NoteState {
  return {
    markdown: blocksToMarkdown(note.body, noteMode(note)),
    version: note.version,
    lyricsMode: note.lyricsMode,
    track: note.track,
    can: note.can,
  };
}

/**
 * The caller's own notebook: every note they authored, pinned first then
 * most recently edited. `listNotes` opens only the sealed summary, so a
 * list never decrypts a body.
 */
async function listNotebook(actor: Actor): Promise<{ notes: NoteSummary[] }> {
  return { notes: await listNotes(actor.id) };
}

/**
 * One notebook note, read in the mode it is stored in. A note the caller may
 * not read — including one that does not exist — answers 404 through
 * `getNote`, the same as any other note read.
 */
export async function readNote(
  actor: Actor,
  noteId: number
): Promise<NoteState> {
  const note = await getNote(noteId, actor.id);
  return noteStateOf(note);
}

/**
 * Replaces a notebook note's body from markdown, in whichever mode the note
 * is already stored in. Passes the stored body into the converter as its
 * `keep` source, so anything the markdown cannot express survives.
 */
async function writeNote(
  actor: Actor,
  noteId: number,
  markdown: string
): Promise<NoteState> {
  const note = await getNote(noteId, actor.id);
  const mode = noteMode(note);
  const blocks = markdownToBlocks(markdown, mode, note.body);
  const saved = await saveOrExplainStale("This note", () =>
    saveNote(noteId, actor.id, note.version, { body: blocks })
  );
  return noteStateOf(saved);
}

/**
 * Creates a new notebook note. Naming a track links it immediately, as that
 * track's lyrics, and stores it in lyrics mode; a note with no track is
 * document mode, overriding `createNote`'s own default of lyrics mode.
 */
async function createNotebookNote(
  actor: Actor,
  markdown: string,
  trackId?: number
): Promise<NoteState> {
  const lyricsMode = trackId != null;
  const blocks = markdownToBlocks(markdown, lyricsMode ? "lyrics" : "document");
  const note = await createNote(actor.id, {
    trackId,
    body: blocks,
    lyricsMode,
  });
  if (note.track) {
    await logLinkChange(
      activityContext(actor),
      { projectId: note.track.projectId, trackId: note.track.id },
      "linked"
    );
  }
  return noteStateOf(note);
}

/**
 * Links a notebook note onto a track, as that track's lyrics. Only the
 * note's author may link it, and only while it is not already linked to one.
 */
async function linkNotebookNote(
  actor: Actor,
  noteId: number,
  trackId: number
): Promise<NoteState> {
  const { note, link } = await linkNote(noteId, actor.id, trackId);
  await logLinkChange(activityContext(actor), link, "linked");
  return noteStateOf(note);
}

/**
 * Returns a notebook note to its author's own notebook, freeing the track it
 * was linked to as lyrics. `note` is null for a caller who is not the author,
 * who can no longer read the note once it is unlinked.
 */
async function unlinkNotebookNote(
  actor: Actor,
  noteId: number
): Promise<{ note: NoteState | null }> {
  const { note, link } = await unlinkNote(noteId, actor.id);
  await logLinkChange(activityContext(actor), link, "unlinked");
  return { note: note && noteStateOf(note) };
}

/** Deletes a notebook note. Only its author may. */
async function deleteNotebookNote(
  actor: Actor,
  noteId: number
): Promise<{ noteId: number }> {
  const link = await deleteNote(noteId, actor.id);
  if (link) await logLinkChange(activityContext(actor), link, "unlinked");
  return { noteId };
}

const readNotesInput = z.object({
  kind: entityKindSchema,
  id: z.number().int(),
});
const notesOutput = z.object({ markdown: z.string() });
const writeNotesInput = readNotesInput.extend({ markdown: z.string() });

const readLyricsInput = z.object({ trackId: z.number().int() });
const readLyricsOutput = z.object({
  markdown: z.string().nullable(),
  noteId: z.number().optional(),
  version: z.number().optional(),
  can: noteRightsSchema.optional(),
});
const writeLyricsInput = z.object({
  trackId: z.number().int(),
  markdown: z.string(),
});
const writeLyricsOutput = z.object({
  markdown: z.string(),
  noteId: z.number(),
  version: z.number(),
});

const listNotebookOutput = z.object({ notes: z.array(noteSummarySchema) });

const noteIdInput = z.object({ noteId: z.number().int() });
const noteStateOutput = z.object({
  markdown: z.string(),
  version: z.number(),
  lyricsMode: z.boolean(),
  track: trackRefSchema.nullable(),
  can: noteRightsSchema,
});
const writeNoteInput = noteIdInput.extend({ markdown: z.string() });
const createNoteInput = z.object({
  markdown: z.string(),
  trackId: z.number().int().positive().optional(),
});
const linkNoteInput = noteIdInput.extend({
  trackId: z.number().int().positive(),
});
const deleteNoteOutput = z.object({ noteId: z.number() });

export const NOTES_TOOLS = [
  defineTool({
    name: "read_notes",
    title: "Read notes",
    description:
      "An entity's own notes as markdown: a project's description, or a " +
      "track's, collection's or session's notes. For the caller's personal " +
      "notebook, addressed by `noteId`, use `read_note` instead.",
    scope: "read",
    idempotent: true,
    input: readNotesInput,
    output: notesOutput,
    run: (actor, { kind, id }) => readNotes(actor, kind, id),
  }),
  defineTool({
    name: "write_notes",
    title: "Write notes",
    description:
      "Replaces an entity's own notes from markdown. Anything the markdown " +
      "cannot express is kept from the stored document through a " +
      "`<!-- keep:id -->` placeholder. For the caller's personal notebook, " +
      "addressed by `noteId`, use `write_note` instead.",
    scope: "write",
    input: writeNotesInput,
    output: notesOutput,
    run: (actor, { kind, id, markdown }) =>
      writeNotes(actor, kind, id, markdown),
  }),
  defineTool({
    name: "read_lyrics",
    title: "Read lyrics",
    description:
      "A track's lyrics as markdown, one line per block with `[Section]` headers. " +
      "`markdown: null` means the track has no lyrics note, or the caller may not " +
      "read the one it has.",
    scope: "read",
    idempotent: true,
    input: readLyricsInput,
    output: readLyricsOutput,
    run: (actor, { trackId }) => readLyrics(actor, trackId),
  }),
  defineTool({
    name: "write_lyrics",
    title: "Write lyrics",
    description:
      "Writes a track's lyrics from markdown, creating and linking a note if the " +
      "track has none. Answers 403 naming the author when someone else's note is " +
      "not the caller's to overwrite, and 409 when the note changed since it was " +
      "last read.",
    scope: "write",
    input: writeLyricsInput,
    output: writeLyricsOutput,
    run: (actor, { trackId, markdown }) =>
      writeLyrics(actor, trackId, markdown),
  }),
  defineTool({
    name: "list_notes",
    title: "List notebook",
    description:
      "The caller's own personal notebook: every note they authored, pinned " +
      "first then most recently edited. This is the caller's notebook, not " +
      "an entity's own notes — use `read_notes` for a project's, track's, " +
      "collection's or session's notes.",
    scope: "read",
    idempotent: true,
    input: z.object({}),
    output: listNotebookOutput,
    run: (actor) => listNotebook(actor),
  }),
  defineTool({
    name: "read_note",
    title: "Read a notebook note",
    description:
      "One of the caller's personal notebook notes, addressed by `noteId`, " +
      "as markdown. Not an entity's own notes — use `read_notes` for those. " +
      "A note the caller may not read, including one that does not exist, " +
      "answers a 404 error.",
    scope: "read",
    idempotent: true,
    input: noteIdInput,
    output: noteStateOutput,
    run: (actor, { noteId }) => readNote(actor, noteId),
  }),
  defineTool({
    name: "write_note",
    title: "Write a notebook note",
    description:
      "Replaces one of the caller's personal notebook notes from markdown, " +
      "in whichever mode it is already stored in. Not an entity's own notes " +
      "— use `write_notes` for those. Answers 409 when the note changed " +
      "elsewhere since it was last read.",
    scope: "write",
    input: writeNoteInput,
    output: noteStateOutput,
    run: (actor, { noteId, markdown }) => writeNote(actor, noteId, markdown),
  }),
  defineTool({
    name: "create_note",
    title: "Create a notebook note",
    description:
      "Creates a new personal notebook note. Naming a track links it " +
      "immediately as that track's lyrics; to copy a note's content onto " +
      "another track's lyrics, read it with `read_note` and write it with " +
      "`write_lyrics`.",
    scope: "write",
    input: createNoteInput,
    output: noteStateOutput,
    run: (actor, { markdown, trackId }) =>
      createNotebookNote(actor, markdown, trackId),
  }),
  defineTool({
    name: "link_note",
    title: "Link a notebook note to a track",
    description:
      "Links one of the caller's personal notebook notes onto a track, as " +
      "that track's lyrics. Only the note's author may link it, and only " +
      "while it is not already linked to one; answers 409 when the track " +
      "already has a note.",
    scope: "write",
    input: linkNoteInput,
    output: noteStateOutput,
    run: (actor, { noteId, trackId }) =>
      linkNotebookNote(actor, noteId, trackId),
  }),
  defineTool({
    name: "unlink_note",
    title: "Unlink a notebook note",
    description:
      "Returns a note to its author's own notebook, freeing the track it " +
      "was linked to as lyrics. A project editor may unlink someone else's " +
      "note; `note` is then null, since only the author can read it afterwards.",
    scope: "write",
    input: noteIdInput,
    output: z.object({ note: noteStateOutput.nullable() }),
    run: (actor, { noteId }) => unlinkNotebookNote(actor, noteId),
  }),
  defineTool({
    name: "delete_note",
    title: "Delete a notebook note",
    description:
      "Permanently deletes one of the caller's notebook notes. Only its author may.",
    scope: "write",
    destructive: true,
    input: noteIdInput,
    output: deleteNoteOutput,
    run: (actor, { noteId }) => deleteNotebookNote(actor, noteId),
  }),
];
