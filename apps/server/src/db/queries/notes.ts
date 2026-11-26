import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { projectsByTrackId } from "../../entities/track/queries.js";
import { noteSummaryText } from "../../lib/block-text.js";
import { notesMasterKeys } from "../../lib/env.js";
import {
  type Envelope,
  newEnvelope,
  openJson,
  rewrap,
  scopeFor,
  sealJson,
  unwrap,
} from "../../lib/notes-crypto.js";
import { db } from "../index.js";
import { recordActivity } from "./activity.js";
import { users } from "../schema/auth.js";
import { blockDocumentSchema, type BlockDocument } from "../schema/base.js";
import { type Note, notes } from "../schema/notes.js";
import { projects } from "../schema/projects.js";
import { tracks } from "../schema/tracks.js";
import { isUniqueViolation } from "../unique-violation.js";
import {
  isMemberAtLeast,
  type MemberRole,
  memberRole,
  roleSatisfies,
} from "./authorization.js";

/** The track a note is linked to, as a note's readers need to see it. */
type TrackRef = {
  id: number;
  title: string;
  projectId: number;
  projectName: string;
};

export type NoteSummary = {
  id: number;
  title: string;
  preview: string;
  pinned: boolean;
  lyricsMode: boolean;
  updatedAt: Date;
  createdAt: Date;
  track: TrackRef | null;
};

type NoteAuthor = { id: string; name: string; image: string | null };

/** What the caller may do — the client renders from this, never re-derives it. */
export type NoteRights = { write: boolean; unlink: boolean; delete: boolean };

export const noteRightsSchema = z.object({
  write: z.boolean(),
  unlink: z.boolean(),
  delete: z.boolean(),
});

export type NoteDetail = NoteSummary & {
  body: BlockDocument;
  version: number;
  author: NoteAuthor;
  can: NoteRights;
};

/** The REST route and the MCP notebook tools both answer a note's linked track this way. */
export const trackRefSchema = z.object({
  id: z.number(),
  title: z.string(),
  projectId: z.number(),
  projectName: z.string(),
});

const noteAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

export const noteSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  preview: z.string(),
  pinned: z.boolean(),
  lyricsMode: z.boolean(),
  updatedAt: z.date(),
  createdAt: z.date(),
  track: trackRefSchema.nullable(),
});

export const noteDetailSchema = noteSummarySchema.extend({
  body: blockDocumentSchema,
  version: z.number(),
  author: noteAuthorSchema,
  can: noteRightsSchema,
});

/** `POST /:id/link` and `link_note` both take just the track to link onto. */
export const linkBodySchema = z.object({
  trackId: z.number().int().positive(),
});

const trackRef = {
  id: tracks.id,
  title: tracks.title,
  projectId: tracks.projectId,
  projectName: projects.name,
};

/** Every column of a left-joined track is null together, when there is no link. */
type JoinedTrack = { [K in keyof TrackRef]: TrackRef[K] | null };

const linkedTrack = (joined: JoinedTrack | null): TrackRef | null => {
  if (!joined) return null;
  const { id, title, projectId, projectName } = joined;
  if (id == null || title == null || projectId == null || projectName == null) {
    return null;
  }
  return { id, title, projectId, projectName };
};

const authorColumns = {
  id: users.id,
  name: users.name,
  image: users.image,
};

type Loaded = {
  /** The stored row, ciphertext included. */
  row: Note;
  track: TrackRef | null;
  author: NoteAuthor;
  /** The project the link puts the note in, if it is linked. */
  projectId: number | null;
  isAuthor: boolean;
  /** The caller's membership in that project, if the note is linked. */
  role: MemberRole | null;
};

/**
 * The scope a note's key is wrapped under must match the scope its link puts it
 * in. Linking and unlinking re-wrap on the spot; a track or project delete only
 * nulls `track_id` through the FK, and a track moved between projects changes
 * the project underneath, so the row is checked on every read and re-wrapped
 * when it has drifted. Concurrent readers may both re-wrap: both write the same
 * scope, so the last write is as correct as the first.
 *
 * `updatedAt` is written back unchanged — a re-wrap leaves the note's content
 * alone, and the author's list is ordered by when the note was last edited.
 */
async function repairScope(row: Note, projectId: number | null): Promise<Note> {
  const expected = scopeFor(row.authorId, projectId);
  if (row.keyScope === expected) return row;

  const envelope: Envelope = rewrap(notesMasterKeys, row, expected);
  const [updated] = await db
    .update(notes)
    .set({ ...envelope, updatedAt: row.updatedAt })
    .where(eq(notes.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * Loads a note the way every route needs it: who is asking decides whether it
 * exists at all. A note the caller may not read answers 404, not 403 — a
 * private note's id must not confirm that a note is there.
 */
async function loadNoteAccess(noteId: number, userId: string): Promise<Loaded> {
  const [found] = await db
    .select({ row: notes, track: trackRef, author: authorColumns })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .leftJoin(tracks, eq(tracks.id, notes.trackId))
    .leftJoin(projects, eq(projects.id, tracks.projectId))
    .where(eq(notes.id, noteId));
  if (!found) throw new HTTPException(404);

  const track = linkedTrack(found.track);
  const projectId = track?.projectId ?? null;
  const isAuthor = found.row.authorId === userId;
  const role = projectId == null ? null : await memberRole(userId, projectId);
  if (!isAuthor && role == null) throw new HTTPException(404);

  return {
    row: await repairScope(found.row, projectId),
    track,
    author: found.author,
    projectId,
    isAuthor,
    role,
  };
}

/**
 * The author always keeps the note, even after leaving the project it is linked
 * to; everyone else reads it through their membership, and writes it from
 * editor upwards. Only the author may delete.
 */
const noteRights = (a: Loaded): NoteRights => {
  const mayEdit =
    a.isAuthor || (a.role != null && roleSatisfies(a.role, "editor"));
  return {
    write: mayEdit,
    unlink: a.track != null && mayEdit,
    delete: a.isAuthor,
  };
};

const dataKey = (row: Note) => unwrap(notesMasterKeys, row);

const summaryOf = (row: Note, track: TrackRef | null): NoteSummary => ({
  id: row.id,
  pinned: row.pinned,
  lyricsMode: row.lyricsMode,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  track,
  ...openJson<{ title: string; preview: string }>(dataKey(row), row.summary),
});

/**
 * A user's own notebook. Only the small `summary` blob is opened, one per row —
 * a list never decrypts a body.
 */
export async function listNotes(userId: string): Promise<NoteSummary[]> {
  const rows = await db
    .select({ row: notes, track: trackRef })
    .from(notes)
    .leftJoin(tracks, eq(tracks.id, notes.trackId))
    .leftJoin(projects, eq(projects.id, tracks.projectId))
    .where(eq(notes.authorId, userId))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt));

  return rows.map(({ row, track }) => summaryOf(row, linkedTrack(track)));
}

/** The id of the note linked to a track as its lyrics, or null when it has none. */
export async function noteIdForTrack(trackId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.trackId, trackId));
  return row?.id ?? null;
}

export async function getNote(
  noteId: number,
  userId: string
): Promise<NoteDetail> {
  const access = await loadNoteAccess(noteId, userId);
  const { row } = access;
  return {
    ...summaryOf(row, access.track),
    body: openJson<BlockDocument>(dataKey(row), row.body),
    version: row.version,
    author: access.author,
    can: noteRights(access),
  };
}

const assertRight = (access: Loaded, right: keyof NoteRights) => {
  if (!noteRights(access)[right]) throw new HTTPException(403);
};

/** The project a track belongs to; a track that is not there answers 404. */
async function projectOfTrack(trackId: number): Promise<number> {
  const projectId = (await projectsByTrackId([trackId])).get(trackId);
  if (projectId == null)
    throw new HTTPException(404, { message: "Track not found" });
  return projectId;
}

async function assertMayLinkTo(userId: string, trackId: number) {
  const projectId = await projectOfTrack(trackId);
  if (!(await isMemberAtLeast(userId, projectId, "editor"))) {
    throw new HTTPException(403);
  }
  return projectId;
}

const TRACK_TAKEN = "That track already has lyrics";

export type NewNote = {
  trackId?: number | null;
  body: BlockDocument;
  lyricsMode?: boolean;
};

/**
 * A note comes into being with its first content: the client holds a blank
 * draft until something is typed, so the create carries the body and there is
 * never an empty row to tidy up.
 */
export async function createNote(
  userId: string,
  input: NewNote
): Promise<NoteDetail> {
  const trackId = input.trackId ?? null;
  const projectId =
    trackId == null ? null : await assertMayLinkTo(userId, trackId);

  const { dataKey: key, envelope } = newEnvelope(
    notesMasterKeys,
    scopeFor(userId, projectId)
  );

  const [row] = await db
    .insert(notes)
    .values({
      authorId: userId,
      trackId,
      lyricsMode: input.lyricsMode ?? true,
      ...envelope,
      body: sealJson(key, input.body),
      summary: sealJson(key, noteSummaryText(input.body)),
    })
    .onConflictDoNothing()
    .returning();

  // The insert yields nothing only when it collides with the unique on
  // `track_id` — the track this note was to be linked to already has one.
  if (!row) throw new HTTPException(409, { message: TRACK_TAKEN });

  return getNote(row.id, userId);
}

export type NotePatch = {
  body?: BlockDocument;
  lyricsMode?: boolean;
  pinned?: boolean;
};

/**
 * One write per save. `version` is the counter the caller loaded; a row that
 * has moved on refuses the write rather than overwriting someone else's edit.
 * Only the fields sent are touched, and the summary follows the body.
 */
export async function saveNote(
  noteId: number,
  userId: string,
  version: number,
  patch: NotePatch
): Promise<NoteDetail> {
  const access = await loadNoteAccess(noteId, userId);
  assertRight(access, "write");
  // Pinning orders the author's own list; nobody else sees the note in one.
  if (patch.pinned !== undefined && !access.isAuthor) {
    throw new HTTPException(403);
  }

  const set: Partial<typeof notes.$inferInsert> = { version: version + 1 };
  if (patch.body !== undefined) {
    const key = dataKey(access.row);
    set.body = sealJson(key, patch.body);
    set.summary = sealJson(key, noteSummaryText(patch.body));
  }
  if (patch.lyricsMode !== undefined) set.lyricsMode = patch.lyricsMode;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;

  const [updated] = await db
    .update(notes)
    .set(set)
    .where(and(eq(notes.id, noteId), eq(notes.version, version)))
    .returning({ id: notes.id });
  if (!updated) {
    throw new HTTPException(409, { message: "This note changed elsewhere" });
  }

  // A lyrics edit is an event on the track, not a diffable field — recorded
  // the same way a link or unlink is, and never carrying the body itself.
  if (patch.body !== undefined && access.track) {
    await recordActivity({
      projectId: access.track.projectId,
      entityType: "track",
      entityId: access.track.id,
      userId,
      action: "updated",
      before: { lyrics: null },
      after: { lyrics: "edited" },
    });
  }

  return getNote(noteId, userId);
}

/** The link a write made or removed, for the activity the route records. */
export type NoteLink = { projectId: number; trackId: number };

export type LinkedNote = { note: NoteDetail; link: NoteLink };

/**
 * Binds a note to a track and re-wraps its key for that track's project, which
 * is what gives the project's members their access. Only the author may hand a
 * note over, and only a note that is not already linked.
 */
export async function linkNote(
  noteId: number,
  userId: string,
  trackId: number
): Promise<LinkedNote> {
  const access = await loadNoteAccess(noteId, userId);
  if (!access.isAuthor || access.row.trackId != null) {
    throw new HTTPException(403);
  }

  const projectId = await assertMayLinkTo(userId, trackId);
  const envelope = rewrap(
    notesMasterKeys,
    access.row,
    scopeFor(access.row.authorId, projectId)
  );

  try {
    await db
      .update(notes)
      .set({ trackId, ...envelope })
      .where(eq(notes.id, noteId));
  } catch (error) {
    // The unique on `track_id` fires on an UPDATE as a plain driver error;
    // `onConflictDoNothing` is insert-only and cannot catch it.
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, { message: TRACK_TAKEN });
    }
    throw error;
  }

  return { note: await getNote(noteId, userId), link: { projectId, trackId } };
}

/** Returns the note to its author's own notebook, re-wrapped for them alone. */
export async function unlinkNote(
  noteId: number,
  userId: string
): Promise<{ note: NoteDetail | null; link: NoteLink }> {
  const access = await loadNoteAccess(noteId, userId);
  const { track } = access;
  if (!track || !noteRights(access).unlink) throw new HTTPException(403);

  const link = { projectId: track.projectId, trackId: track.id };
  const envelope = rewrap(
    notesMasterKeys,
    access.row,
    scopeFor(access.row.authorId, null)
  );
  await db
    .update(notes)
    .set({ trackId: null, ...envelope })
    .where(eq(notes.id, noteId));

  // An unlinked note belongs to its author alone, so a project member who
  // unlinked someone else's note can no longer read it: they get no note back.
  return {
    note: access.isAuthor ? await getNote(noteId, userId) : null,
    link,
  };
}

/** Deletes a note, answering with the link it held so the route can log it. */
export async function deleteNote(
  noteId: number,
  userId: string
): Promise<NoteLink | null> {
  const access = await loadNoteAccess(noteId, userId);
  assertRight(access, "delete");
  await db.delete(notes).where(eq(notes.id, noteId));

  const { track } = access;
  return track && { projectId: track.projectId, trackId: track.id };
}
