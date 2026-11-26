import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index.js";
import { users } from "./schema/auth.js";
import { objects, repoObjects, saveObjects } from "./schema/objects.js";
import { priorityLevels } from "./schema/priority-levels.js";
import { projects } from "./schema/projects.js";
import { branches, commits, repos } from "./schema/repos.js";
import { saves } from "./schema/saves.js";
import {
  editSessionSchema,
  newSessionSchema,
  sessions,
} from "./schema/sessions.js";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "./unique-violation.js";

const projectIds: number[] = [];
const userIds: string[] = [];
const objectHashes: string[] = [];

afterEach(async () => {
  if (projectIds.length) {
    await db.delete(projects).where(inArray(projects.id, projectIds));
  }
  if (userIds.length) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (objectHashes.length) {
    await db.delete(objects).where(inArray(objects.hash, objectHashes));
  }
  projectIds.length = userIds.length = objectHashes.length = 0;
});

/**
 * A project holding a repo, an adopted session, one branch carrying one
 * commit that names one save, and two objects: one held by the repo, one by
 * the save.
 */
async function seed() {
  const label = randomUUID();
  const [user] = await db
    .insert(users)
    .values({ id: label, name: "Dit", email: `${label}@example.test` })
    .returning();
  userIds.push(user!.id);
  const [project] = await db
    .insert(projects)
    .values({ name: `Repo schema ${label}` })
    .returning();
  projectIds.push(project!.id);
  const [level] = await db
    .insert(priorityLevels)
    .values({
      projectId: project!.id,
      name: "None",
      colour: "#6C7278",
      rank: 0,
      isDefault: true,
    })
    .returning();
  const [repo] = await db
    .insert(repos)
    .values({ projectId: project!.id, name: "set", createdBy: user!.id })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({
      name: "Demo",
      daw: "ableton",
      projectId: project!.id,
      priorityId: level!.id,
      repoId: repo!.id,
      ditSetId: "set-1",
    })
    .returning();
  const [branch] = await db
    .insert(branches)
    .values({ sessionId: session!.id, name: "main" })
    .returning();
  await db
    .update(sessions)
    .set({ currentBranchId: branch!.id })
    .where(eq(sessions.id, session!.id));
  const [save] = await db
    .insert(saves)
    .values({
      sessionId: session!.id,
      projectId: project!.id,
      fileUpdatedAt: new Date(),
      source: "dit",
      branchId: branch!.id,
    })
    .returning();
  const [commit] = await db
    .insert(commits)
    .values({
      repoId: repo!.id,
      sessionId: session!.id,
      branchId: branch!.id,
      hash: label,
      saveId: save!.id,
      message: "first",
      authorId: user!.id,
      kind: "user",
      committedAt: new Date(),
    })
    .returning();
  await db
    .update(branches)
    .set({ headCommitId: commit!.id })
    .where(eq(branches.id, branch!.id));

  const [repoObject, saveObject] = [`${label}-repo`, `${label}-save`];
  objectHashes.push(repoObject, saveObject);
  await db.insert(objects).values([
    { hash: repoObject, kind: 1, size: 10 },
    { hash: saveObject, kind: 2, size: 5_000_000_000 },
  ]);
  await db
    .insert(repoObjects)
    .values({ repoId: repo!.id, objectHash: repoObject, pushedBy: user!.id });
  await db
    .insert(saveObjects)
    .values({ saveId: save!.id, objectHash: saveObject });

  return {
    user: user!,
    project: project!,
    repo: repo!,
    session: session!,
    branch: branch!,
    save: save!,
    commit: commit!,
    repoObject,
    saveObject,
  };
}

/**
 * What Postgres raises for a delete a `restrict` foreign key refuses: 23001
 * from Postgres 18, the plain foreign-key 23503 before it.
 */
const RESTRICT_VIOLATIONS = ["23001", "23503"];

/** Drizzle wraps the driver's error, so the SQLSTATE sits on its `cause`. */
const sqlState = (error: unknown) =>
  (error as { cause?: { code?: string } }).cause?.code;

const rejection = async (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: unknown) => error
  );

describe("repo tables", () => {
  it("stores a repo, a session, a branch, a save, a commit and objects", async () => {
    const rows = await seed();

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, rows.session.id));
    expect(session).toMatchObject({
      repoId: rows.repo.id,
      ditSetId: "set-1",
      currentBranchId: rows.branch.id,
    });
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, rows.branch.id));
    expect(branch?.headCommitId).toBe(rows.commit.id);
    const [stored] = await db
      .select()
      .from(objects)
      .where(eq(objects.hash, rows.saveObject));
    expect(stored?.size).toBe(5_000_000_000);
  });

  it("cascades a repo delete to its commits and repo objects, and clears the session's repo", async () => {
    const rows = await seed();

    await db.delete(repos).where(eq(repos.id, rows.repo.id));

    expect(
      await db.select().from(commits).where(eq(commits.repoId, rows.repo.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(repoObjects)
        .where(eq(repoObjects.repoId, rows.repo.id))
    ).toHaveLength(0);
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, rows.session.id));
    expect(session?.repoId).toBeNull();
    expect(session?.ditSetId).toBe("set-1");
    expect(
      await db.select().from(saves).where(eq(saves.id, rows.save.id))
    ).toHaveLength(1);
  });

  it("refuses to delete an object a repo or a save still references", async () => {
    const rows = await seed();

    const heldByRepo = await rejection(
      db.delete(objects).where(eq(objects.hash, rows.repoObject))
    );
    const heldBySave = await rejection(
      db.delete(objects).where(eq(objects.hash, rows.saveObject))
    );

    expect(sqlState(heldByRepo)).toBeOneOf(RESTRICT_VIOLATIONS);
    expect(sqlState(heldBySave)).toBeOneOf(RESTRICT_VIOLATIONS);
    expect(
      await db.select().from(objects).where(eq(objects.hash, rows.repoObject))
    ).toHaveLength(1);
  });

  it("deletes an object once nothing references it", async () => {
    const rows = await seed();
    await db
      .delete(repoObjects)
      .where(eq(repoObjects.objectHash, rows.repoObject));

    await db.delete(objects).where(eq(objects.hash, rows.repoObject));

    expect(
      await db.select().from(objects).where(eq(objects.hash, rows.repoObject))
    ).toHaveLength(0);
  });

  it("refuses to delete a save a commit names", async () => {
    const rows = await seed();

    const error = await rejection(
      db.delete(saves).where(eq(saves.id, rows.save.id))
    );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("deletes a session together with its branches, saves, commits and their object links", async () => {
    const rows = await seed();

    await db.delete(sessions).where(eq(sessions.id, rows.session.id));

    expect(
      await db.select().from(branches).where(eq(branches.id, rows.branch.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(saves).where(eq(saves.id, rows.save.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(commits).where(eq(commits.id, rows.commit.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(saveObjects)
        .where(eq(saveObjects.objectHash, rows.saveObject))
    ).toHaveLength(0);
    expect(
      await db.select().from(repos).where(eq(repos.id, rows.repo.id))
    ).toHaveLength(1);
  });

  it("deletes a project together with its repo, history and object links", async () => {
    const rows = await seed();

    await db.delete(projects).where(eq(projects.id, rows.project.id));

    expect(
      await db.select().from(repos).where(eq(repos.id, rows.repo.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(commits).where(eq(commits.id, rows.commit.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(repoObjects)
        .where(eq(repoObjects.objectHash, rows.repoObject))
    ).toHaveLength(0);
  });

  it("clears branch and commit pointers when what they name is deleted", async () => {
    const rows = await seed();

    await db
      .update(branches)
      .set({ headCommitId: null })
      .where(eq(branches.id, rows.branch.id));
    await db.delete(commits).where(eq(commits.id, rows.commit.id));
    const [second] = await db
      .insert(commits)
      .values({
        repoId: rows.repo.id,
        sessionId: rows.session.id,
        branchId: rows.branch.id,
        hash: `${rows.repoObject}-2`,
        saveId: rows.save.id,
        message: "second",
        kind: "checkpoint",
        committedAt: new Date(),
      })
      .returning();
    const [child] = await db
      .insert(commits)
      .values({
        repoId: rows.repo.id,
        sessionId: rows.session.id,
        branchId: rows.branch.id,
        hash: `${rows.repoObject}-3`,
        saveId: rows.save.id,
        parentId: second!.id,
        message: "third",
        kind: "user",
        committedAt: new Date(),
      })
      .returning();
    await db
      .update(branches)
      .set({ headCommitId: child!.id })
      .where(eq(branches.id, rows.branch.id));

    await db.delete(commits).where(eq(commits.id, child!.id));
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, rows.branch.id));
    expect(branch?.headCommitId).toBeNull();

    await db.delete(commits).where(eq(commits.id, second!.id));
    await db.delete(branches).where(eq(branches.id, rows.branch.id));
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, rows.session.id));
    expect(session?.currentBranchId).toBeNull();
    const [save] = await db
      .select()
      .from(saves)
      .where(eq(saves.id, rows.save.id));
    expect(save?.branchId).toBeNull();
  });

  it("clears the author, creator and pusher when the user is deleted", async () => {
    const rows = await seed();

    await db.delete(users).where(eq(users.id, rows.user.id));

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, rows.repo.id));
    const [commit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, rows.commit.id));
    const [pushed] = await db
      .select()
      .from(repoObjects)
      .where(eq(repoObjects.objectHash, rows.repoObject));
    expect(repo?.createdBy).toBeNull();
    expect(commit?.authorId).toBeNull();
    expect(pushed?.pushedBy).toBeNull();
  });

  it("keeps a repo name unique within its project and a set id unique within its repo", async () => {
    const rows = await seed();

    const sameName = await rejection(
      db
        .insert(repos)
        .values({ projectId: rows.project.id, name: rows.repo.name })
    );
    const sameSet = await rejection(
      db.insert(sessions).values({
        name: "Twin",
        daw: "ableton",
        projectId: rows.project.id,
        priorityId: rows.session.priorityId,
        repoId: rows.repo.id,
        ditSetId: "set-1",
      })
    );
    const sameCommit = await rejection(
      db.insert(commits).values({
        repoId: rows.repo.id,
        sessionId: rows.session.id,
        branchId: rows.branch.id,
        hash: rows.commit.hash,
        saveId: rows.save.id,
        message: "again",
        kind: "user",
        committedAt: new Date(),
      })
    );

    expect(isUniqueViolation(sameName)).toBe(true);
    expect(isUniqueViolation(sameSet)).toBe(true);
    expect(isUniqueViolation(sameCommit)).toBe(true);
  });

  it("lets sessions with no repo share a null set id", async () => {
    const rows = await seed();
    const twin = {
      daw: "ableton",
      projectId: rows.project.id,
      priorityId: rows.session.priorityId,
    };

    await db.insert(sessions).values([
      { ...twin, name: "A" },
      { ...twin, name: "B" },
    ]);
  });

  it("keeps the dit columns out of the session write schemas", () => {
    const dit = { repoId: 1, ditSetId: "set-1", currentBranchId: 1 };

    const created = newSessionSchema.parse({
      name: "Demo",
      daw: "ableton",
      projectId: 1,
      ...dit,
    });
    const edited = editSessionSchema.parse(dit);

    for (const key of Object.keys(dit)) {
      expect(created, `create keeps ${key}`).not.toHaveProperty(key);
      expect(edited, `edit keeps ${key}`).not.toHaveProperty(key);
    }
  });
});
