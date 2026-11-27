import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { activity } from "../db/schema/activity.js";
import { sessions } from "../db/schema/sessions.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  registerMachine,
  savePayload,
  trackSeeds,
} from "../test/dit-history.js";
import { setupSuite } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

const suite = setupSuite("Repos");
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);
const { owner, requireProject, request, expectAccess, mkTrack, mkSession } =
  suite;

const post = (
  path: string,
  body: unknown,
  caller: "owner" | "editor" = "owner"
) => request(caller, path, { method: "POST", body: JSON.stringify(body) });

async function mkRepo(name: string) {
  const res = await post(`/projects/${suite.projectId}/repos`, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; name: string; sets: unknown[] };
}

async function sessionRow(id: number) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row!;
}

afterEach(() => {
  restoreInstancePolicy();
});

const patch = (
  path: string,
  body: unknown,
  caller: "owner" | "editor" = "owner"
) => request(caller, path, { method: "PATCH", body: JSON.stringify(body) });

describe("repos", () => {
  describe("POST /projects/:id/repos", () => {
    it("creates a repo, then returns the existing one of that name", async () => {
      requireProject();
      const path = `/projects/${suite.projectId}/repos`;

      const created = await post(path, { name: "Create or return" });
      expect(created.status).toBe(201);
      const repo = await created.json();
      expect(repo).toMatchObject({
        name: "Create or return",
        projectId: suite.projectId,
        createdBy: owner.userId,
        sets: [],
      });

      const again = await post(path, { name: "Create or return" }, "editor");
      expect(again.status).toBe(200);
      expect((await again.json()).id).toBe(repo.id);
    });

    it("refuses a viewer, hides the project from a stranger and rejects an empty name", async () => {
      requireProject();
      await expectAccess(
        "POST",
        `/projects/${suite.projectId}/repos`,
        { editor: 201, owner: 200, viewer: 403 },
        { name: "Gated" }
      );

      const empty = await post(`/projects/${suite.projectId}/repos`, {
        name: "  ",
      });
      expect(empty.status).toBe(400);
    });
  });

  describe("GET /projects/:id/repos", () => {
    it("lists the project's repos with each adopted set's session", async () => {
      requireProject();
      const repo = await mkRepo("Listed");
      const adopted = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-listed",
        fileName: "Listed.als",
      });
      const { sessionId } = await adopted.json();

      await expectAccess(
        "GET",
        `/projects/${suite.projectId}/repos`,
        { viewer: 200, editor: 200, owner: 200 },
        undefined,
        (rows) => {
          const listed = (rows as { id: number; sets: unknown[] }[]).find(
            (row) => row.id === repo.id
          );
          expect(listed?.sets).toEqual([
            {
              ditSetId: "set-listed",
              sessionId,
              sessionName: "Listed",
              localFilepath: null,
              branches: [],
            },
          ]);
        }
      );
    });

    it("names the repo on the session detail, null for a session in none", async () => {
      requireProject();
      const repo = await mkRepo("Named");
      const adopted = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-named",
        fileName: "Named.als",
      });
      const { sessionId } = await adopted.json();
      const loose = (await suite.mkSession({ name: "Loose session" })).id;

      const detail = async (id: number) =>
        (await (await request("owner", `/sessions/${id}`)).json()) as {
          repoId: number | null;
          repoName: string | null;
        };
      expect(await detail(sessionId)).toMatchObject({
        repoId: repo.id,
        repoName: "Named",
      });
      expect(await detail(loose)).toMatchObject({
        repoId: null,
        repoName: null,
      });
    });

    it("lists no repo of another project", async () => {
      requireProject();
      const other = await suite.throwawayProject("Repo list");
      const foreign = await suite.requestAs(
        other.owner,
        `/projects/${other.id}/repos`,
        { method: "POST", body: JSON.stringify({ name: "Foreign" }) }
      );
      expect(foreign.status).toBe(201);

      const mine = await request("owner", `/projects/${suite.projectId}/repos`);
      const names = ((await mine.json()) as { name: string }[]).map(
        (row) => row.name
      );
      expect(names).not.toContain("Foreign");
    });
  });

  describe("GET /repos/:id", () => {
    it("returns the repo to every member and 404s a stranger", async () => {
      requireProject();
      const repo = await mkRepo("Fetched");
      await expectAccess(
        "GET",
        `/repos/${repo.id}`,
        { viewer: 200, editor: 200, owner: 200 },
        undefined,
        (body) => expect(body).toMatchObject({ id: repo.id, name: "Fetched" })
      );
    });

    it("answers 404, never 403, for a repo in another project and for no repo", async () => {
      requireProject();
      const other = await suite.throwawayProject("Repo get");
      const foreign = await suite.requestAs(
        other.owner,
        `/projects/${other.id}/repos`,
        { method: "POST", body: JSON.stringify({ name: "Foreign" }) }
      );
      const { id } = await foreign.json();

      expect((await request("owner", `/repos/${id}`)).status).toBe(404);
      expect((await request("owner", "/repos/999999999")).status).toBe(404);
      expect(
        (await post(`/repos/${id}/sets`, { ditSetId: "s", fileName: "S.als" }))
          .status
      ).toBe(404);
    });
  });

  describe("POST /repos/:id/sets", () => {
    it("creates a session named after the file, on the track, and logs it", async () => {
      requireProject();
      const repo = await mkRepo("Creating");
      const trackId = await mkTrack("Creating track");

      const res = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-a",
        fileName: "My Song.als",
        trackId,
      });
      expect(res.status).toBe(201);
      const { sessionId, ditSetId } = await res.json();
      expect(ditSetId).toBe("set-a");

      expect(await sessionRow(sessionId)).toMatchObject({
        name: "My Song",
        daw: "ableton",
        dawName: "Ableton Live",
        localFilepath: null,
        trackId,
        projectId: suite.projectId,
        repoId: repo.id,
        ditSetId: "set-a",
      });

      const logged = await db
        .select()
        .from(activity)
        .where(
          and(
            eq(activity.entityType, "session"),
            eq(activity.entityId, sessionId)
          )
        );
      expect(logged).toMatchObject([
        { action: "created", projectId: suite.projectId, userId: owner.userId },
      ]);
    });

    it("answers the same session again for a set already adopted", async () => {
      requireProject();
      const repo = await mkRepo("Idempotent");
      const body = { ditSetId: "set-a", fileName: "Again.als" };

      const first = await post(`/repos/${repo.id}/sets`, body);
      expect(first.status).toBe(201);
      const { sessionId } = await first.json();

      const second = await post(`/repos/${repo.id}/sets`, body);
      expect(second.status).toBe(200);
      expect((await second.json()).sessionId).toBe(sessionId);

      const named = await post(`/repos/${repo.id}/sets`, {
        ...body,
        sessionId,
      });
      expect(named.status).toBe(200);

      const other = await mkSession({ name: "Other" });
      const different = await post(`/repos/${repo.id}/sets`, {
        ...body,
        sessionId: other.id,
      });
      expect(different.status).toBe(409);
      expect((await sessionRow(other.id)).repoId).toBeNull();
    });

    it("adopts one session when two requests race for the same set", async () => {
      requireProject();
      const repo = await mkRepo("Racing");
      const body = { ditSetId: "set-race", fileName: "Race.als" };

      const results = await Promise.all([
        post(`/repos/${repo.id}/sets`, body),
        post(`/repos/${repo.id}/sets`, body),
        post(`/repos/${repo.id}/sets`, body),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 200, 201]);
      const ids = await Promise.all(
        results.map(async (res) => (await res.json()).sessionId)
      );
      expect(new Set(ids).size).toBe(1);
    });

    it("links an existing session of the project", async () => {
      requireProject();
      const repo = await mkRepo("Linking");
      const existing = await mkSession({ name: "Existing" });

      const res = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-link",
        fileName: "Existing.als",
        sessionId: existing.id,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ditSetId: "set-link",
        sessionId: existing.id,
      });
      expect(await sessionRow(existing.id)).toMatchObject({
        name: "Existing",
        repoId: repo.id,
        ditSetId: "set-link",
      });
    });

    it("answers 409 for a session that another repo, or another set, holds", async () => {
      requireProject();
      const repo = await mkRepo("Conflicts");
      const rival = await mkRepo("Rival");
      const held = await mkSession({ name: "Held" });
      await post(`/repos/${rival.id}/sets`, {
        ditSetId: "set-rival",
        fileName: "Held.als",
        sessionId: held.id,
      });

      const elsewhere = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-x",
        fileName: "Held.als",
        sessionId: held.id,
      });
      expect(elsewhere.status).toBe(409);

      const underAnotherSet = await post(`/repos/${rival.id}/sets`, {
        ditSetId: "set-y",
        fileName: "Held.als",
        sessionId: held.id,
      });
      expect(underAnotherSet.status).toBe(409);
      expect(await sessionRow(held.id)).toMatchObject({
        repoId: rival.id,
        ditSetId: "set-rival",
      });
    });

    it("answers 404 for a session or track outside the repo's project", async () => {
      requireProject();
      const repo = await mkRepo("Foreign refs");
      const other = await suite.throwawayProject("Repo sets");
      const foreignSession = await suite.requestAs(other.owner, "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "F",
          daw: "ableton",
          projectId: other.id,
        }),
      });
      const foreignTrack = await suite.requestAs(other.owner, "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "F",
          artists: ["A"],
          projectId: other.id,
        }),
      });

      const linked = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-f1",
        fileName: "F.als",
        sessionId: (await foreignSession.json()).id,
      });
      expect(linked.status).toBe(404);

      const created = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-f2",
        fileName: "F.als",
        trackId: (await foreignTrack.json()).id,
      });
      expect(created.status).toBe(404);

      const missing = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "set-f3",
        fileName: "F.als",
        sessionId: 999999999,
      });
      expect(missing.status).toBe(404);
    });

    it("rejects a body that names both a session and a track, or no file", async () => {
      requireProject();
      const repo = await mkRepo("Bad bodies");
      const both = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "s",
        fileName: "S.als",
        sessionId: 1,
        trackId: 1,
      });
      expect(both.status).toBe(400);

      const bare = await post(`/repos/${repo.id}/sets`, {
        ditSetId: "s",
        fileName: ".als",
      });
      expect(bare.status).toBe(400);
    });

    it("refuses a viewer and hides the repo from a stranger", async () => {
      requireProject();
      const repo = await mkRepo("Roles");
      await expectAccess(
        "POST",
        `/repos/${repo.id}/sets`,
        { viewer: 403, editor: 201 },
        { ditSetId: "set-roles", fileName: "Roles.als" }
      );
    });
  });

  describe("PATCH /repos/:id", () => {
    it("lets an editor switch push-samples on and off, and answers the repo shape", async () => {
      requireProject();
      const repo = await mkRepo("Switch");
      expect(
        await (await request("owner", `/repos/${repo.id}`)).json()
      ).toMatchObject({
        pushSamples: false,
        pushSamplesForced: false,
        storage: { setBytes: 0, sampleBytes: 0, sharedBytes: 0 },
      });

      const on = await patch(
        `/repos/${repo.id}`,
        { pushSamples: true },
        "editor"
      );
      expect(on.status).toBe(200);
      expect(await on.json()).toMatchObject({
        id: repo.id,
        pushSamples: true,
        pushSamplesForced: false,
      });
      expect(
        (await (await request("owner", `/repos/${repo.id}`)).json()).pushSamples
      ).toBe(true);

      const off = await patch(`/repos/${repo.id}`, { pushSamples: false });
      expect((await off.json()).pushSamples).toBe(false);
    });

    it("refuses a viewer, hides the repo from a stranger and rejects a body without the switch", async () => {
      requireProject();
      const repo = await mkRepo("Switch roles");
      await expectAccess(
        "PATCH",
        `/repos/${repo.id}`,
        { viewer: 403, editor: 200, owner: 200 },
        { pushSamples: true }
      );
      expect((await patch(`/repos/${repo.id}`, {})).status).toBe(400);
      expect(
        (await patch(`/repos/${repo.id}`, { pushSamples: "yes" })).status
      ).toBe(400);
    });

    it("reads on and locked while the instance forces it, and refuses turning it off", async () => {
      requireProject();
      const repo = await mkRepo("Forced");
      stubInstancePolicy({ limits: { pushSamplesEverywhere: true } });

      const read = await (await request("owner", `/repos/${repo.id}`)).json();
      expect(read).toMatchObject({
        pushSamples: true,
        pushSamplesForced: true,
      });

      const off = await patch(`/repos/${repo.id}`, { pushSamples: false });
      expect(off.status).toBe(409);
      const on = await patch(`/repos/${repo.id}`, { pushSamples: true });
      expect(on.status).toBe(200);
      expect(await on.json()).toMatchObject({
        pushSamples: true,
        pushSamplesForced: true,
      });

      restoreInstancePolicy();
      // The switch kept its own value once the instance stopped forcing it.
      expect(
        await (await request("owner", `/repos/${repo.id}`)).json()
      ).toMatchObject({ pushSamples: true, pushSamplesForced: false });
    });
  });
});

describe("repo reads with branches and tips", () => {
  const T0 = Date.UTC(2026, 5, 1);

  async function seedSet(label: string, trackId?: number) {
    const set = await adoptNewSet(suite, label);
    if (trackId != null) {
      await db
        .update(sessions)
        .set({ trackId })
        .where(eq(sessions.id, set.sessionId));
    }
    const first = savePayload(`${label}-1`, T0);
    const second = savePayload(`${label}-2`, T0 + 60_000);
    const side = savePayload(`${label}-3`, T0 + 120_000);
    await seedObjects(set.repoId, owner.userId, [
      ...objectsOf(first),
      ...objectsOf(second),
      ...objectsOf(side),
    ]);
    await pushSaves(suite, set, "main", [first, second]);
    await pushSaves(suite, set, "side", [side]);
    const c1 = commitPayload(`${label}-c1`, null, [first]);
    const c2 = commitPayload(`${label}-c2`, c1.hash, [second]);
    await pushCommits(suite, set, "main", [c1, c2]);
    await pushCommits(suite, set, "side", [
      commitPayload(`${label}-c3`, null, [side]),
    ]);
    return { set, c2 };
  }

  type RepoRead = {
    id: number;
    sets: {
      sessionId: number;
      sessionName: string;
      branches: {
        name: string;
        tip: { commitId: number; message: string } | null;
      }[];
    }[];
  };

  it("shows each set's session name and its branches' tips, main first", async () => {
    requireProject();
    const { set, c2 } = await seedSet("Tips");

    const res = await request("viewer", `/repos/${set.repoId}`);
    expect(res.status).toBe(200);
    const repo = (await res.json()) as RepoRead;
    const [only] = repo.sets;
    expect(only?.sessionName).toBe("Tips");
    expect(only?.branches.map((branch) => branch.name)).toEqual([
      "main",
      "side",
    ]);
    expect(only?.branches[0]?.tip?.message).toBe(c2.message);
    expect(only?.branches[1]?.tip).not.toBeNull();
  });

  it("answers a set with no commits an empty branch list", async () => {
    requireProject();
    const bare = await adoptNewSet(suite, "No commits");
    const repo = (await (
      await request("owner", `/repos/${bare.repoId}`)
    ).json()) as RepoRead;
    expect(repo.sets[0]?.branches).toEqual([]);
  });

  it("lists the repos of a track, and of a collection holding it", async () => {
    requireProject();
    const trackId = await mkTrack("Repo track");
    const otherTrack = await suite.mkTrack("Other repo track");
    const collectionId = await suite.mkCollection("Repo collection");
    const added = await request(
      "owner",
      `/collections/${collectionId}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ trackId, trackNumber: 1 }),
      }
    );
    expect(added.status).toBe(200);

    const { set } = await seedSet("On track", trackId);
    const elsewhere = await seedSet("Off track", otherTrack);
    await adoptNewSet(suite, "Unfiled");

    for (const path of [
      `/tracks/${trackId}/repos`,
      `/collections/${collectionId}/repos`,
    ]) {
      await expectAccess(
        "GET",
        path,
        { viewer: 200, editor: 200, owner: 200 },
        undefined,
        (rows) => {
          const list = rows as RepoRead[];
          expect(list.map((row) => row.id)).toEqual([set.repoId]);
          expect(list[0]?.sets[0]?.branches).toHaveLength(2);
          expect(list[0]).toMatchObject({
            pushSamples: false,
            pushSamplesForced: false,
            storage: {
              setBytes: expect.any(Number),
              sampleBytes: expect.any(Number),
              sharedBytes: expect.any(Number),
            },
          });
        }
      );
    }
    expect(elsewhere.set.repoId).not.toBe(set.repoId);

    const none = await request("owner", `/tracks/${otherTrack}/repos`);
    expect(((await none.json()) as RepoRead[]).map((row) => row.id)).toEqual([
      elsewhere.set.repoId,
    ]);
    const empty = await request(
      "owner",
      `/collections/${await suite.mkCollection("Empty repo collection")}/repos`
    );
    expect(await empty.json()).toEqual([]);
  });

  it("answers 404, never 403, for another project's track and collection", async () => {
    requireProject();
    const other = await suite.throwawayProject("Entity repos");
    const track = await suite.requestAs(other.owner, "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: "Foreign",
        artists: ["A"],
        projectId: other.id,
      }),
    });
    const { id: foreignTrack } = await track.json();
    const collection = await suite.requestAs(other.owner, "/collections", {
      method: "POST",
      body: JSON.stringify({ title: "Foreign", projectId: other.id }),
    });
    const { id: foreignCollection } = await collection.json();

    expect(
      (await request("owner", `/tracks/${foreignTrack}/repos`)).status
    ).toBe(404);
    expect(
      (await request("owner", `/collections/${foreignCollection}/repos`)).status
    ).toBe(404);
    expect((await request("owner", "/tracks/999999999/repos")).status).toBe(
      404
    );
  });

  it("tracks per-machine repo paths and populates sessions.localFilepath across create, adopt and push", async () => {
    requireProject();
    const mac = await registerMachine(suite, "owner", "Mac Studio Paths");
    const laptop = await registerMachine(suite, "owner", "Laptop Paths");

    const created = await request(
      "owner",
      `/projects/${suite.projectId}/repos`,
      {
        method: "POST",
        headers: { "X-Machine-Id": mac },
        body: JSON.stringify({
          name: "Tasmania Project",
          localPath: "/Users/spence/Music/Tasmania Project",
        }),
      }
    );
    expect(created.status).toBe(201);
    const repo = (await created.json()) as {
      id: number;
      localPath: string | null;
      localPaths: { machineId: string; machineName: string; path: string }[];
    };
    expect(repo.localPath).toBe("/Users/spence/Music/Tasmania Project");
    expect(repo.localPaths).toMatchObject([
      {
        machineId: mac,
        machineName: "Mac Studio Paths",
        path: "/Users/spence/Music/Tasmania Project",
      },
    ]);

    const adopted = await request("owner", `/repos/${repo.id}/sets`, {
      method: "POST",
      headers: { "X-Machine-Id": mac },
      body: JSON.stringify({
        ditSetId: "set-tasmania",
        fileName: "Tasmania.als",
        localPath: "/Users/spence/Music/Tasmania Project",
        localFilepath: "/Users/spence/Music/Tasmania Project/Tasmania.als",
      }),
    });
    expect(adopted.status).toBe(201);
    const { sessionId } = (await adopted.json()) as { sessionId: number };
    const adoptedSession = await sessionRow(sessionId);
    expect(adoptedSession.localFilepath).toBe(
      "/Users/spence/Music/Tasmania Project/Tasmania.als"
    );
    expect(adoptedSession.localFileMachineName).toBe("Mac Studio Paths");

    // Second machine pushes saves from its own folder path; both machine paths stay recorded.
    const save = savePayload("tasmania-laptop", Date.UTC(2026, 6, 1), {
      machineName: "Laptop Paths",
    });
    const pushed = await request("owner", `/repos/${repo.id}/saves`, {
      method: "POST",
      headers: { "X-Machine-Id": laptop },
      body: JSON.stringify({
        ditSetId: "set-tasmania",
        branch: "main",
        saves: [save],
        localPath: "/Volumes/Work/Tasmania Project",
        localFilepath: "/Volumes/Work/Tasmania Project/Tasmania.als",
      }),
    });
    expect(pushed.status).toBe(200);

    const detail = (await (
      await request("owner", `/repos/${repo.id}`)
    ).json()) as {
      localPath: string | null;
      localPaths: { machineId: string; machineName: string; path: string }[];
      sets: { ditSetId: string; localFilepath: string | null }[];
    };
    // Preferred localPath follows lastPushMachine (laptop).
    expect(detail.localPath).toBe("/Volumes/Work/Tasmania Project");
    expect(detail.localPaths).toHaveLength(2);
    expect(detail.localPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          machineId: mac,
          path: "/Users/spence/Music/Tasmania Project",
        }),
        expect.objectContaining({
          machineId: laptop,
          path: "/Volumes/Work/Tasmania Project",
        }),
      ])
    );
    expect(detail.sets[0]?.localFilepath).toBe(
      "/Volumes/Work/Tasmania Project/Tasmania.als"
    );
  });
});
