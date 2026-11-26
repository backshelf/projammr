import { HTTPException } from "hono/http-exception";
import { isEntityKind } from "../../entities/index.js";
import { defineResource } from "../spec.js";
import { readLyrics, readNote, readNotes } from "../tools/notes.js";

export const NOTES_RESOURCES = [
  defineResource({
    template: "projammr://tracks/{trackId}/lyrics",
    name: "track-lyrics",
    title: "Track lyrics",
    description: "A track's lyrics as markdown.",
    mimeType: "text/markdown",
    read: async (actor, params) => {
      const result = await readLyrics(actor, Number(params.trackId));
      return result.markdown ?? "";
    },
  }),
  defineResource({
    template: "projammr://{kind}/{id}/notes",
    name: "entity-notes",
    title: "Entity notes",
    description:
      "An entity's notes as markdown: a project's description, or a track's, " +
      "collection's or session's notes.",
    mimeType: "text/markdown",
    read: async (actor, params) => {
      const kind = params.kind ?? "";
      if (!isEntityKind(kind)) {
        throw new HTTPException(400, {
          message: `Unknown entity kind: ${kind}`,
        });
      }
      const { markdown } = await readNotes(actor, kind, Number(params.id));
      return markdown;
    },
  }),
  defineResource({
    template: "projammr://notes/{noteId}",
    name: "notebook-note",
    title: "Notebook note",
    description:
      "One of the caller's personal notebook notes as markdown, not an " +
      "entity's own notes.",
    mimeType: "text/markdown",
    read: async (actor, params) => {
      const { markdown } = await readNote(actor, Number(params.noteId));
      return markdown;
    },
  }),
];
