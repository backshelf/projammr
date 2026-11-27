import { describe, expect, it } from "bun:test";
import { setupSuite } from "../../test/fixtures.js";
import {
  adoptSet,
  createOrGetRepo,
  getRepo,
  listRepos,
  projectIdForRepo,
} from "./repos.js";

const suite = setupSuite("Repo queries");
const { requireProject, mkSession } = suite;

const mkRepo = async (name: string) =>
  (await createOrGetRepo(suite.projectId, name, suite.owner.userId)).repo;

describe("createOrGetRepo", () => {
  it("creates once per name and returns the same repo after", async () => {
    requireProject();
    const first = await createOrGetRepo(
      suite.projectId,
      "Once",
      suite.owner.userId
    );
    const second = await createOrGetRepo(
      suite.projectId,
      "Once",
      suite.editor.userId
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.repo.id).toBe(first.repo.id);
    expect(second.repo.createdBy).toBe(suite.owner.userId);
  });

  it("settles concurrent creates of one name on a single row", async () => {
    requireProject();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        createOrGetRepo(suite.projectId, "Concurrent", suite.owner.userId)
      )
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.repo.id)).size).toBe(1);
  });
});

describe("repo reads", () => {
  it("resolves a repo's project, and nothing for an unknown id", async () => {
    requireProject();
    const repo = await mkRepo("Resolved");

    expect(await projectIdForRepo(repo.id)).toBe(suite.projectId);
    expect(await projectIdForRepo(999999999)).toBeNull();
  });

  it("lists a project's repos with the sets each holds, and 404s an unknown repo", async () => {
    requireProject();
    const repo = await mkRepo("With sets");
    const { sessionId } = await adoptSet(
      { id: repo.id, projectId: suite.projectId },
      suite.owner.userId,
      { ditSetId: "set-1", fileName: "One.als" }
    );

    const listed = (await listRepos(suite.projectId)).find(
      (row) => row.id === repo.id
    );
    const set = {
      ditSetId: "set-1",
      sessionId,
      sessionName: "One",
      localFilepath: null,
    };
    expect(listed?.sets).toEqual([{ ...set, branches: [] }]);
    expect((await getRepo(repo.id)).sets).toEqual([{ ...set, branches: [] }]);
    await expect(getRepo(999999999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("adoptSet", () => {
  it("reports a created session once and the held one after", async () => {
    requireProject();
    const repo = await mkRepo("Adopting");
    const scope = { id: repo.id, projectId: suite.projectId };
    const body = { ditSetId: "set-1", fileName: "Adopting.als" };

    const first = await adoptSet(scope, suite.owner.userId, body);
    const second = await adoptSet(scope, suite.owner.userId, body);

    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
  });

  it("links an unclaimed session without creating one", async () => {
    requireProject();
    const repo = await mkRepo("Linking");
    const session = await mkSession({ name: "Unclaimed" });

    const adopted = await adoptSet(
      { id: repo.id, projectId: suite.projectId },
      suite.owner.userId,
      { ditSetId: "set-1", fileName: "Unclaimed.als", sessionId: session.id }
    );

    expect(adopted).toEqual({
      ditSetId: "set-1",
      sessionId: session.id,
      created: false,
    });
  });

  it("refuses a session another set of the repo holds", async () => {
    requireProject();
    const repo = await mkRepo("Taken");
    const scope = { id: repo.id, projectId: suite.projectId };
    const { sessionId } = await adoptSet(scope, suite.owner.userId, {
      ditSetId: "set-1",
      fileName: "Taken.als",
    });

    await expect(
      adoptSet(scope, suite.owner.userId, {
        ditSetId: "set-2",
        fileName: "Taken.als",
        sessionId,
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});
