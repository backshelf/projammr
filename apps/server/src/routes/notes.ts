import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  createNote,
  deleteNote,
  linkBodySchema,
  linkNote,
  listNotes,
  getNote,
  noteDetailSchema,
  noteSummarySchema,
  saveNote,
  unlinkNote,
} from "../db/queries/notes.js";
import { blockDocumentSchema } from "../db/schema/base.js";
import { blockLines } from "../lib/block-text.js";
import { describer, idParam, respond, validator } from "../lib/http.js";
import { logLinkChange } from "./activity-log.js";

const { describe, describeRaw } = describer("Notes");

const app = new Hono<AuthedEnv>();

const notesSchema = z.array(noteSummarySchema);

const notePatchSchema = z.object({
  version: z.number().int(),
  body: blockDocumentSchema.optional(),
  lyricsMode: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

const createBodySchema = z.object({
  body: blockDocumentSchema,
  trackId: z.number().int().positive().optional(),
  lyricsMode: z.boolean().optional(),
});

const noteTextSchema = z.object({ text: z.string() });

app.get(
  "/",
  describe(
    "The signed-in user's own notebook: every note they authored, pinned first then most recently edited",
    { schema: notesSchema, description: "The caller's notes" }
  ),
  async (c) => respond(c, notesSchema, await listNotes(c.get("user").id))
);

app.post(
  "/",
  describe(
    "Create a note. Naming a track links it immediately, as that track's lyrics.",
    { status: 201, schema: noteDetailSchema, description: "Note created" },
    400,
    403,
    404,
    409
  ),
  validator("json", createBodySchema),
  async (c) => {
    const input = c.req.valid("json");
    const note = await createNote(c.get("user").id, input);
    if (note.track) {
      await logLinkChange(
        c,
        { projectId: note.track.projectId, trackId: note.track.id },
        "linked"
      );
    }
    return respond(c, noteDetailSchema, note, 201);
  }
);

app.get(
  "/:id",
  describe(
    "Get one note",
    { schema: noteDetailSchema, description: "The note" },
    404
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    return respond(c, noteDetailSchema, await getNote(id, c.get("user").id));
  }
);

app.get(
  "/:id/text",
  describe(
    "The note's body as plain text, one written line per block",
    { schema: noteTextSchema, description: "Plain text of the note" },
    404
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    const note = await getNote(id, c.get("user").id);
    return respond(c, noteTextSchema, {
      text: blockLines(note.body).join("\n"),
    });
  }
);

app.patch(
  "/:id",
  describe(
    "Save changes to a note. `version` is the one the caller last read; a note " +
      "changed elsewhere since answers 409.",
    { schema: noteDetailSchema, description: "Note updated" },
    400,
    403,
    404,
    409
  ),
  idParam(),
  validator("json", notePatchSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { version, ...patch } = c.req.valid("json");
    return respond(
      c,
      noteDetailSchema,
      await saveNote(id, c.get("user").id, version, patch)
    );
  }
);

app.post(
  "/:id/link",
  describe(
    "Link a note to a track, making it that track's lyrics. Only the note's " +
      "author may link it, and only while it is not already linked.",
    { schema: noteDetailSchema, description: "Note linked" },
    403,
    404,
    409
  ),
  idParam(),
  validator("json", linkBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { trackId } = c.req.valid("json");
    const { note, link } = await linkNote(id, c.get("user").id, trackId);
    await logLinkChange(c, link, "linked");
    return respond(c, noteDetailSchema, note);
  }
);

app.post(
  "/:id/unlink",
  describe(
    "Unlink a note from its track. Returns the note to its author's own notebook, freeing the track it was linked to.",
    {
      schema: noteDetailSchema.nullable(),
      description:
        "Note unlinked; null when the caller is not its author and so can no longer read it",
    },
    403,
    404
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    const { note, link } = await unlinkNote(id, c.get("user").id);
    await logLinkChange(c, link, "unlinked");
    return respond(c, noteDetailSchema.nullable(), note);
  }
);

app.delete(
  "/:id",
  describeRaw(
    "Delete a note. Only its author may.",
    { status: 204, description: "Note deleted" },
    403,
    404
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    const link = await deleteNote(id, c.get("user").id);
    if (link) await logLinkChange(c, link, "unlinked");
    return c.body(null, 204);
  }
);

export default app;
