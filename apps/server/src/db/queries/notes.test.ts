import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { deleteTrack } from "../../entities/track/queries.js";
import { db } from "../index.js";
import { users } from "../schema/auth.js";
import { notes } from "../schema/notes.js";
import { members, projects } from "../schema/projects.js";
import { tracks } from "../schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import { invalidateMembershipCache } from "./authorization.js";
import { moveTrackToProject } from "./move.js";
import { withDefaultLevel } from "./priority-levels.js";
import {
  createNote,
  deleteNote,
  getNote,
  linkNote,
  listNotes,
  saveNote,
  unlinkNote,
} from "./notes.js";

/**
 * The note rules turn on who the caller is relative to the note's author and to
 * the project its track sits in, so every case needs a project with members of
 * several ranks. Rows are seeded straight into the database — the query layer
 * is the thing under test, not the routes above it — and the projects are
 * dropped in `afterAll`, taking their tracks and notes with them.
 */
let author: string;
let editor: string;
let viewer: string;
let outsider: string;
let projectId: number;

const seededProjects: number[] = [];
const seededUsers: string[] = [];

let counter = 0;
const unique = (label: string) =>
  `${label}-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2, 6)}`;

async function seedUser(label: string): Promise<string> {
  const id = unique(label).replace(/[^a-zA-Z0-9-]/g, "");
  await db
    .insert(users)
    .values({ id, name: label, email: `${id}@example.com` });
  seededUsers.push(id);
  return id;
}

async function seedProject(label: string): Promise<number> {
  const [row] = await db
    .insert(projects)
    .values({ name: unique(label) })
    .returning({ id: projects.id });
  seededProjects.push(row!.id);
  await seedScale(row!.id);
  return row!.id;
}

const seedMember = async (
  project: number,
  userId: string,
  role: "viewer" | "editor" | "admin" | "owner"
) => {
  await db.insert(members).values({ projectId: project, userId, role });
  invalidateMembershipCache(userId, project);
};

async function seedTrack(project = projectId): Promise<number> {
  const [row] = await db
    .insert(tracks)
    .values(
      await withDefaultLevel({
        title: unique("Track"),
        artists: [],
        projectId: project,
      })
    )
    .returning({ id: tracks.id });
  return row!.id;
}

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const doc = (...lines: string[]) => lines.map(paragraph);

const storedRow = async (noteId: number) =>
  (await db.select().from(notes).where(eq(notes.id, noteId)))[0];

beforeAll(async () => {
  author = await seedUser("Author");
  editor = await seedUser("Editor");
  viewer = await seedUser("Viewer");
  outsider = await seedUser("Outsider");
  projectId = await seedProject("Notes");
  await seedMember(projectId, author, "owner");
  await seedMember(projectId, editor, "editor");
  await seedMember(projectId, viewer, "viewer");
});

afterAll(async () => {
  for (const id of seededProjects) {
    await db.delete(projects).where(eq(projects.id, id));
  }
  for (const id of seededUsers) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("createNote and getNote", () => {
  it("titles a note from the first two written lines of its body", async () => {
    const note = await createNote(author, {
      body: [paragraph(""), ...doc("Verse one", "the preview")],
    });

    expect(note.title).toBe("Verse one");
    expect(note.preview).toBe("the preview");
    expect(note.version).toBe(1);
    expect(note.track).toBeNull();
    expect(note.author.id).toBe(author);
    expect(note.can).toEqual({ write: true, unlink: false, delete: true });
  });

  it("hands the body back exactly as it was stored", async () => {
    const body = doc("Hook", "Second line");
    const { id } = await createNote(author, { body });
    expect((await getNote(id, author)).body).toEqual(body);
  });

  it("wraps an unlinked note's key for its author", async () => {
    const { id } = await createNote(author, { body: doc("Private") });
    expect((await storedRow(id))?.keyScope).toBe(`user:${author}`);
  });

  it("wraps a note created against a track for that track's project", async () => {
    const trackId = await seedTrack();
    const { id, track } = await createNote(author, {
      body: doc("Linked at birth"),
      trackId,
    });

    expect(track).toMatchObject({ id: trackId, projectId });
    expect((await storedRow(id))?.keyScope).toBe(`project:${projectId}`);
  });

  it("refuses a track the caller may not write in", async () => {
    const trackId = await seedTrack();
    await expect(
      createNote(viewer, { body: doc("Nope"), trackId })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("answers 404 for a track that does not exist", async () => {
    await expect(
      createNote(author, { body: doc("Nope"), trackId: -1 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("answers 409 when the track already has a note", async () => {
    const trackId = await seedTrack();
    await createNote(author, { body: doc("First"), trackId });
    await expect(
      createNote(editor, { body: doc("Second"), trackId })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("access", () => {
  it("hides an unlinked note from everyone but its author", async () => {
    const { id } = await createNote(author, { body: doc("Just mine") });

    await expect(getNote(id, editor)).rejects.toMatchObject({ status: 404 });
    await expect(getNote(id, outsider)).rejects.toMatchObject({ status: 404 });
  });

  it("lets a project viewer read a linked note but not write it", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Shared"), trackId });

    const read = await getNote(note.id, viewer);
    expect(read.title).toBe("Shared");
    expect(read.can).toEqual({ write: false, unlink: false, delete: false });

    await expect(
      saveNote(note.id, viewer, read.version, { body: doc("Meddling") })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lets a project editor write a linked note but not delete it", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Shared"), trackId });

    const read = await getNote(note.id, editor);
    expect(read.can).toEqual({ write: true, unlink: true, delete: false });

    const saved = await saveNote(note.id, editor, read.version, {
      body: doc("Editor's line"),
    });
    expect(saved.title).toBe("Editor's line");

    await expect(deleteNote(note.id, editor)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("keeps the note for an author who has left the project", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Still mine"), trackId });

    await db
      .delete(members)
      .where(and(eq(members.userId, author), eq(members.projectId, projectId)));
    invalidateMembershipCache(author, projectId);

    const read = await getNote(note.id, author);
    expect(read.can).toEqual({ write: true, unlink: true, delete: true });
    const saved = await saveNote(note.id, author, read.version, {
      body: doc("Written from outside"),
    });
    expect(saved.title).toBe("Written from outside");

    await seedMember(projectId, author, "owner");
  });

  it("refuses to pin a note the caller did not write", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Shared"), trackId });

    await expect(
      saveNote(note.id, editor, note.version, { pinned: true })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("answers 404 for a note that does not exist", async () => {
    await expect(getNote(-1, author)).rejects.toMatchObject({ status: 404 });
  });
});

describe("saveNote", () => {
  it("bumps the version and follows the body with the summary", async () => {
    const note = await createNote(author, { body: doc("Draft") });

    const saved = await saveNote(note.id, author, note.version, {
      body: doc("Chorus", "and its second line"),
    });

    expect(saved.version).toBe(note.version + 1);
    expect(saved.title).toBe("Chorus");
    expect(saved.preview).toBe("and its second line");
  });

  it("touches only the fields it was given", async () => {
    const note = await createNote(author, { body: doc("Keep me") });

    const saved = await saveNote(note.id, author, note.version, {
      lyricsMode: true,
      pinned: true,
    });

    expect(saved.body).toEqual(doc("Keep me"));
    expect(saved.lyricsMode).toBe(true);
    expect(saved.pinned).toBe(true);
  });

  it("refuses a stale version and leaves the note as it was", async () => {
    const note = await createNote(author, { body: doc("Original") });
    await saveNote(note.id, author, note.version, { body: doc("Winner") });

    await expect(
      saveNote(note.id, author, note.version, { body: doc("Loser") })
    ).rejects.toMatchObject({ status: 409 });

    expect((await getNote(note.id, author)).title).toBe("Winner");
  });
});

describe("listNotes", () => {
  it("returns the caller's own notes, pinned first then most recent", async () => {
    const listUser = await seedUser("Lister");
    const older = await createNote(listUser, { body: doc("Older") });
    const newer = await createNote(listUser, { body: doc("Newer") });
    const pinned = await createNote(listUser, { body: doc("Pinned") });
    await saveNote(pinned.id, listUser, pinned.version, { pinned: true });

    const list = await listNotes(listUser);

    expect(list.map((note) => note.id)).toEqual([
      pinned.id,
      newer.id,
      older.id,
    ]);
    expect(list.map((note) => note.title)).toEqual([
      "Pinned",
      "Newer",
      "Older",
    ]);
  });

  it("carries the track a note is linked to and never a body", async () => {
    const listUser = await seedUser("TrackLister");
    await seedMember(projectId, listUser, "editor");
    const trackId = await seedTrack();
    await createNote(listUser, { body: doc("Linked"), trackId });

    const [summary] = await listNotes(listUser);

    expect(summary?.track).toMatchObject({ id: trackId, projectId });
    expect(summary).not.toHaveProperty("body");
  });
});

describe("linkNote and unlinkNote", () => {
  it("re-wraps the key for the track's project and back again", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("To be linked") });
    expect((await storedRow(note.id))?.keyScope).toBe(`user:${author}`);

    const linked = await linkNote(note.id, author, trackId);
    expect(linked.link).toEqual({ projectId, trackId });
    expect(linked.note.track).toMatchObject({ id: trackId, projectId });
    expect((await storedRow(note.id))?.keyScope).toBe(`project:${projectId}`);
    expect(linked.note.body).toEqual(doc("To be linked"));

    const unlinked = await unlinkNote(note.id, author);
    expect(unlinked.link).toEqual({ projectId, trackId });
    expect(unlinked.note?.track).toBeNull();
    expect((await storedRow(note.id))?.keyScope).toBe(`user:${author}`);
    expect(unlinked.note?.body).toEqual(doc("To be linked"));
  });

  it("answers 409 when the track already has a note", async () => {
    const trackId = await seedTrack();
    await createNote(author, { body: doc("Sitting there"), trackId });
    const other = await createNote(author, { body: doc("Latecomer") });

    await expect(linkNote(other.id, author, trackId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("lets only the author link, and only a note that is free", async () => {
    const note = await createNote(author, { body: doc("Mine to give") });
    await expect(
      linkNote(note.id, editor, await seedTrack())
    ).rejects.toMatchObject({ status: 404 });

    await linkNote(note.id, author, await seedTrack());
    await expect(
      linkNote(note.id, author, await seedTrack())
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a track in a project the author may not write in", async () => {
    const elsewhere = await seedProject("Elsewhere");
    const note = await createNote(author, { body: doc("Wandering") });

    await expect(
      linkNote(note.id, author, await seedTrack(elsewhere))
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to unlink a note that is not linked", async () => {
    const note = await createNote(author, { body: doc("Free") });
    await expect(unlinkNote(note.id, author)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("deleteNote", () => {
  it("answers with the link the note held", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Doomed"), trackId });

    expect(await deleteNote(note.id, author)).toEqual({ projectId, trackId });
    await expect(getNote(note.id, author)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("answers with nothing for an unlinked note", async () => {
    const note = await createNote(author, { body: doc("Doomed") });
    expect(await deleteNote(note.id, author)).toBeNull();
  });
});

/**
 * Nothing hooks a track delete or a cross-project move, so a linked note is
 * left wrapped for a project it no longer belongs to. The read path notices and
 * re-wraps in place, which is what keeps the key rule and the access rule the
 * same rule.
 */
describe("envelope repair", () => {
  it("returns a note to its author's scope when its track is deleted", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Orphaned"), trackId });
    expect((await storedRow(note.id))?.keyScope).toBe(`project:${projectId}`);

    await deleteTrack(trackId);

    const read = await getNote(note.id, author);
    expect(read.track).toBeNull();
    expect(read.body).toEqual(doc("Orphaned"));
    expect((await storedRow(note.id))?.keyScope).toBe(`user:${author}`);
  });

  it("re-wraps for the new project when its track moves", async () => {
    const target = await seedProject("Move Target");
    await seedMember(target, author, "owner");
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Travelling"), trackId });

    await moveTrackToProject(trackId, target, author);

    const read = await getNote(note.id, author);
    expect(read.track).toMatchObject({ id: trackId, projectId: target });
    expect(read.body).toEqual(doc("Travelling"));
    expect((await storedRow(note.id))?.keyScope).toBe(`project:${target}`);
  });

  it("leaves the note's own timestamp alone when it repairs", async () => {
    const trackId = await seedTrack();
    const note = await createNote(author, { body: doc("Untouched"), trackId });

    await deleteTrack(trackId);

    expect((await getNote(note.id, author)).updatedAt).toEqual(note.updatedAt);
  });

  it("hands a linked note's readers over with it when the track moves", async () => {
    const target = await seedProject("Second Home");
    const newEditor = await seedUser("New Editor");
    await seedMember(target, author, "owner");
    await seedMember(target, newEditor, "editor");
    const trackId = await seedTrack();
    const note = await createNote(author, {
      body: doc("Handed over"),
      trackId,
    });

    await expect(getNote(note.id, newEditor)).rejects.toMatchObject({
      status: 404,
    });
    await moveTrackToProject(trackId, target, author);

    expect((await getNote(note.id, newEditor)).can.write).toBe(true);
    await expect(getNote(note.id, viewer)).rejects.toMatchObject({
      status: 404,
    });
  });
});
