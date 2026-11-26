import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { app } from "../../app.js";
import { settleJobs } from "../../test/media.js";
import { db } from "../index.js";
import { images } from "../schema/images.js";
import { objects, repoObjects, saveSampleObjects } from "../schema/objects.js";
import { priorityLevels } from "../schema/priority-levels.js";
import { saves } from "../schema/saves.js";
import { sessions } from "../schema/sessions.js";
import { storageUsage } from "../schema/storage-usage.js";
import { createOrGetRepo } from "./repos.js";
import {
  baseUrl,
  cookieHeaders,
  setupSuite,
  signUpAndSignIn,
  trustedOrigin,
} from "../../test/fixtures.js";
import {
  allUsageReports,
  instanceUsedBytes,
  newRepoObjectScopes,
  projectScope,
  recomputeUsage,
  repoBytes,
  repoStorages,
  repositoryBytesByProject,
  sharedRepoStorage,
  usageFor,
  userScope,
} from "./storage-usage.js";

const suite = setupSuite("Storage usage");
const { owner, outsider, requireProject, request, uploadAsset, uploadAvatar } =
  suite;

/** An upload response, with the size the row it created recorded. */
type Uploaded = { id: number; size: number };

const upload = async (name: string): Promise<Uploaded> =>
  (await uploadAsset(name)) as unknown as Uploaded;

/** The counters of the suite's project and its owner, together. */
const counters = async () => ({
  project: await usageFor(projectScope(suite.projectId)),
  user: await usageFor(userScope(owner.userId)),
});

describe("storage counters", () => {
  it("counts an upload against both the project and the uploader", async () => {
    requireProject();
    const before = await counters();

    const asset = await upload("counted.txt");

    const after = await counters();
    expect(after.project - before.project).toBe(asset.size);
    expect(after.user - before.user).toBe(asset.size);
  });

  it("takes an asset's bytes off both counters when it is deleted", async () => {
    requireProject();
    const asset = await upload("deleted.txt");
    const before = await counters();

    const res = await request("owner", `/assets/${asset.id}`, {
      method: "DELETE",
    });
    expect(res.ok).toBe(true);

    const after = await counters();
    expect(before.project - after.project).toBe(asset.size);
    expect(before.user - after.user).toBe(asset.size);
  });

  it("counts an avatar against its uploader and no project", async () => {
    requireProject();
    const before = await counters();

    const avatar = await uploadAvatar("avatar.jpeg");
    const image = await db.query.images.findFirst({
      where: { id: avatar.id },
    });

    const after = await counters();
    expect(after.user - before.user).toBe(image!.size);
    expect(after.project).toBe(before.project);
  });

  it("counts an image's resizes on top of the original", async () => {
    requireProject();
    const before = await counters();

    const form = new FormData();
    form.append(
      "file",
      new File([await readFile("./testimage.jpeg")], "resized.jpeg", {
        type: "image/jpeg",
      })
    );
    form.append("projectId", String(suite.projectId));
    const res = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    const uploaded = (await res.json()) as {
      id: number;
      variantsJobId: number;
    };

    // The resizes are a queued job, so the bytes arrive once it has run.
    await settleJobs([uploaded.variantsJobId]);

    const [row] = await db
      .select({ size: images.size, variantBytes: images.variantBytes })
      .from(images)
      .where(eq(images.id, uploaded.id));
    expect(row!.variantBytes).toBeGreaterThan(0);

    const after = await counters();
    expect(after.project - before.project).toBe(row!.size + row!.variantBytes);
  });

  it("repairs a counter that has been written wrong", async () => {
    requireProject();
    await uploadAsset("repaired.txt");
    const correct = await usageFor(projectScope(suite.projectId));

    await db
      .update(storageUsage)
      .set({ bytes: correct + 9_999_999 })
      .where(eq(storageUsage.scopeId, String(suite.projectId)));

    const drift = await recomputeUsage([projectScope(suite.projectId)]);

    expect(await usageFor(projectScope(suite.projectId))).toBe(correct);
    expect(drift).toEqual([
      {
        scopeKind: "project",
        scopeId: String(suite.projectId),
        recordedBytes: correct + 9_999_999,
        actualBytes: correct,
      },
    ]);
  });

  it("drops a project's counter when the project is deleted", async () => {
    const throwaway = await suite.throwawayProject("Deleted");
    const form = new FormData();
    form.append(
      "file",
      new File(["bytes"], "doomed.txt", { type: "text/plain" })
    );
    form.append("projectId", String(throwaway.id));
    await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: throwaway.owner.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(await usageFor(projectScope(throwaway.id))).toBeGreaterThan(0);

    const deleted = await app.request(`${baseUrl}/projects/${throwaway.id}`, {
      method: "DELETE",
      headers: cookieHeaders(throwaway.owner.cookie),
    });
    expect(deleted.ok).toBe(true);

    expect(await usageFor(projectScope(throwaway.id))).toBe(0);
    expect(await usageFor(userScope(throwaway.owner.userId))).toBe(0);
  });
});

describe("GET /projects/:id/storage", () => {
  it("reports the project's usage to a viewer", async () => {
    requireProject();
    await uploadAsset("reported.txt");

    const res = await request("viewer", `/projects/${suite.projectId}/storage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scopeKind: "project",
      scopeId: String(suite.projectId),
      usedBytes: await usageFor(projectScope(suite.projectId)),
      limitBytes: null,
      repositoryBytes: 0,
    });
  });

  it("refuses a caller who is not in the project", async () => {
    requireProject();
    const res = await request(
      "outsider",
      `/projects/${suite.projectId}/storage`
    );
    expect(res.status).toBe(404);
  });
});

describe("repo objects", () => {
  const seeded: string[] = [];

  /** An object row with a hash of its own, so parallel files never meet. */
  const seedObject = async (size: number): Promise<string> => {
    const hash = randomUUID().replaceAll("-", "");
    await db.insert(objects).values({ hash, kind: 0, size });
    seeded.push(hash);
    return hash;
  };

  /** Links with an explicit time, so "earliest" never rests on the clock's grain. */
  const clock = Date.parse("2026-01-01T00:00:00Z");
  let tick = 0;
  const link = (
    repoId: number,
    hash: string,
    pushedBy: string | null,
    pushedAt = new Date(clock + 1000 * tick++)
  ) =>
    db
      .insert(repoObjects)
      .values({ repoId, objectHash: hash, pushedBy, pushedAt });

  /** A project with two repos and two members, and a third party's project. */
  const setUpProjects = async (name: string) => {
    const home = await suite.throwawayProject(`${name} Home`);
    const elsewhere = await suite.throwawayProject(`${name} Elsewhere`);
    const make = async (projectId: number, repoName: string, userId: string) =>
      (await createOrGetRepo(projectId, repoName, userId)).repo.id;
    return {
      home,
      elsewhere,
      repoA: await make(home.id, "a", home.owner.userId),
      repoB: await make(home.id, "b", home.owner.userId),
      foreign: await make(elsewhere.id, "c", elsewhere.owner.userId),
    };
  };

  /** Has a session of the repo's project list the object as a sample, as a commit's own save does. */
  const listAsSample = async (
    project: { id: number },
    repoId: number,
    hash: string
  ) => {
    const [priority] = await db
      .select({ id: priorityLevels.id })
      .from(priorityLevels)
      .where(eq(priorityLevels.projectId, project.id))
      .limit(1);
    const [session] = await db
      .insert(sessions)
      .values({
        name: `listing ${hash.slice(0, 8)}`,
        daw: "manual",
        priorityId: priority!.id,
        projectId: project.id,
        repoId,
      })
      .returning({ id: sessions.id });
    const [save] = await db
      .insert(saves)
      .values({
        sessionId: session!.id,
        projectId: project.id,
        fileUpdatedAt: new Date(),
        source: "dit",
      })
      .returning({ id: saves.id });
    await db
      .insert(saveSampleObjects)
      .values({ saveId: save!.id, objectHash: hash });
  };

  afterAll(async () => {
    if (seeded.length === 0) return;
    await db
      .delete(saveSampleObjects)
      .where(inArray(saveSampleObjects.objectHash, seeded));
    await db.delete(repoObjects).where(inArray(repoObjects.objectHash, seeded));
    await db.delete(objects).where(inArray(objects.hash, seeded));
  });

  it("charges an object to the project of its earliest push and to no other, however many repos and projects hold it", async () => {
    const { home, elsewhere, repoA, repoB, foreign } =
      await setUpProjects("Project term");
    const shared = await seedObject(100);
    const onlyInA = await seedObject(10);
    const early = await seedObject(1000);
    await link(repoA, shared, home.owner.userId);
    await link(repoB, shared, home.owner.userId);
    await link(repoA, onlyInA, home.owner.userId);
    await link(foreign, shared, elsewhere.owner.userId);
    // Pushed first elsewhere, later by home: elsewhere pays.
    await link(foreign, early, elsewhere.owner.userId);
    await link(repoA, early, home.owner.userId);

    await recomputeUsage([projectScope(home.id), projectScope(elsewhere.id)]);

    expect(await usageFor(projectScope(home.id))).toBe(110);
    expect(await repoBytes(home.id)).toBe(110);
    expect(await usageFor(projectScope(elsewhere.id))).toBe(1000);
  });

  it("charges an object to the user who pushed it first, once, and a later pusher pays nothing", async () => {
    const { home, elsewhere, repoA, repoB, foreign } =
      await setUpProjects("User term");
    const shared = await seedObject(100);
    await link(repoA, shared, home.owner.userId);
    await link(repoB, shared, home.owner.userId);
    await link(foreign, shared, elsewhere.owner.userId);
    await link(repoB, await seedObject(7), null);

    await recomputeUsage([
      userScope(home.owner.userId),
      userScope(elsewhere.owner.userId),
    ]);

    expect(await usageFor(userScope(home.owner.userId))).toBe(100);
    expect(await usageFor(userScope(elsewhere.owner.userId))).toBe(0);
  });

  it("breaks a tie in the push time by the lower repo id", async () => {
    const { home, elsewhere, repoA, foreign } = await setUpProjects("Tie");
    const hash = await seedObject(9);
    const at = new Date(clock + 5_000_000);
    await link(foreign, hash, elsewhere.owner.userId, at);
    await link(repoA, hash, home.owner.userId, at);
    const lower = Math.min(repoA, foreign);

    await recomputeUsage([projectScope(home.id), projectScope(elsewhere.id)]);

    expect(await usageFor(projectScope(home.id))).toBe(lower === repoA ? 9 : 0);
    expect(await usageFor(projectScope(elsewhere.id))).toBe(
      lower === foreign ? 9 : 0
    );
  });

  it("repairs the counters of a project and a pusher that were written wrong", async () => {
    const { home, repoA } = await setUpProjects("Repair");
    await link(repoA, await seedObject(64), home.owner.userId);

    const drift = await recomputeUsage([
      projectScope(home.id),
      userScope(home.owner.userId),
    ]);

    expect(drift.map((d) => [d.scopeKind, d.actualBytes])).toEqual(
      expect.arrayContaining([
        ["project", 64],
        ["user", 64],
      ])
    );
    expect(await recomputeUsage([projectScope(home.id)])).toEqual([]);
  });

  it("reports a project's repo bytes beside its usage", async () => {
    const { home, repoA } = await setUpProjects("Report");
    await link(repoA, await seedObject(48), home.owner.userId);
    await recomputeUsage([projectScope(home.id)]);

    const res = await app.request(`${baseUrl}/projects/${home.id}/storage`, {
      headers: cookieHeaders(home.owner.cookie),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scopeKind: "project",
      scopeId: String(home.id),
      usedBytes: 48,
      limitBytes: null,
      repositoryBytes: 48,
    });
  });

  it("names the project and the pusher for an object no repo holds, and nobody once one does", async () => {
    const { home, repoA, repoB, foreign } = await setUpProjects("Scopes");
    const hash = await seedObject(5);
    const pusher = home.owner.userId;

    expect(await newRepoObjectScopes(db, repoA, hash, pusher)).toEqual([
      projectScope(home.id),
      userScope(pusher),
    ]);
    expect(await newRepoObjectScopes(db, repoA, hash, null)).toEqual([
      projectScope(home.id),
    ]);

    await link(repoA, hash, pusher);

    // A later link costs nothing: another repo, another member, another project.
    expect(await newRepoObjectScopes(db, repoB, hash, pusher)).toEqual([]);
    expect(
      await newRepoObjectScopes(db, repoB, hash, home.editor.userId)
    ).toEqual([]);
    expect(await newRepoObjectScopes(db, foreign, hash, pusher)).toEqual([]);
  });

  it("moves the charge to the earliest remaining push when the paying project is deleted", async () => {
    const { home, elsewhere, repoA, foreign } = await setUpProjects("Move");
    const hash = await seedObject(40);
    await link(repoA, hash, home.owner.userId);
    await link(foreign, hash, elsewhere.owner.userId);
    await recomputeUsage([
      projectScope(home.id),
      projectScope(elsewhere.id),
      userScope(home.owner.userId),
      userScope(elsewhere.owner.userId),
    ]);
    expect(await usageFor(projectScope(elsewhere.id))).toBe(0);

    const deleted = await app.request(`${baseUrl}/projects/${home.id}`, {
      method: "DELETE",
      headers: cookieHeaders(home.owner.cookie),
    });
    expect(deleted.ok).toBe(true);

    expect(await usageFor(projectScope(elsewhere.id))).toBe(40);
    expect(await usageFor(userScope(elsewhere.owner.userId))).toBe(40);
    expect(await usageFor(userScope(home.owner.userId))).toBe(0);
  });

  it("reports what a project pays, what a repo holds and what sharing saves", async () => {
    const { home, elsewhere, repoA, foreign } = await setUpProjects("Report2");
    const shared = await seedObject(60);
    await link(repoA, shared, home.owner.userId);
    await link(foreign, shared, elsewhere.owner.userId);
    const plain = await seedObject(7);
    await link(foreign, plain, elsewhere.owner.userId);
    await listAsSample(home, repoA, shared);
    await listAsSample(elsewhere, foreign, shared);

    const paid = await repositoryBytesByProject();
    expect(paid.get(home.id)).toBe(60);
    expect(paid.get(elsewhere.id) ?? 0).toBe(7);
    expect((await repoStorages([repoA])).get(repoA)).toEqual({
      setBytes: 0,
      sampleBytes: 60,
      sharedBytes: 0,
    });
    // Held by both, paid for by the first: the second saves its 60 bytes.
    expect((await repoStorages([foreign])).get(foreign)).toEqual({
      setBytes: 7,
      sampleBytes: 60,
      sharedBytes: 60,
    });
    // Other files in this database add more; this pair alone adds 60.
    expect((await sharedRepoStorage()).savedBytes).toBeGreaterThanOrEqual(60);
    expect((await sharedRepoStorage()).projects).toBeGreaterThanOrEqual(2);
  });

  it("re-derives to the same sums the write path counted", async () => {
    const { home, elsewhere, repoA, repoB, foreign } =
      await setUpProjects("Audit");
    const hash = await seedObject(25);
    const own = await seedObject(3);
    await link(repoA, hash, home.owner.userId);
    await link(repoB, own, home.owner.userId);
    await link(foreign, hash, elsewhere.owner.userId);
    const scopes = [
      projectScope(home.id),
      projectScope(elsewhere.id),
      userScope(home.owner.userId),
      userScope(elsewhere.owner.userId),
    ];
    await recomputeUsage(scopes);

    expect(await recomputeUsage(scopes)).toEqual([]);
    expect(await usageFor(projectScope(home.id))).toBe(28);
    expect(await usageFor(projectScope(elsewhere.id))).toBe(0);
  });

  it("re-derives a deleted project's pushers, not just its uploaders", async () => {
    const { home, repoA } = await setUpProjects("Deleted");
    const pusher = home.editor.userId;
    await link(repoA, await seedObject(32), pusher);
    await recomputeUsage([projectScope(home.id), userScope(pusher)]);
    expect(await usageFor(userScope(pusher))).toBe(32);

    const deleted = await app.request(`${baseUrl}/projects/${home.id}`, {
      method: "DELETE",
      headers: cookieHeaders(home.owner.cookie),
    });
    expect(deleted.ok).toBe(true);

    expect(await usageFor(projectScope(home.id))).toBe(0);
    expect(await usageFor(userScope(pusher))).toBe(0);
  });
});

describe("GET /admin/storage", () => {
  it("answers 404 to an account that does not administer the instance", async () => {
    const res = await app.request(`${baseUrl}/admin/storage`, {
      headers: cookieHeaders(outsider.cookie),
    });
    expect(res.status).toBe(404);
  });

  it("answers 401 to a caller with no session", async () => {
    const res = await app.request(`${baseUrl}/admin/storage`);
    expect(res.status).toBe(401);
  });

  it("totals the instance without counting a project's files twice", async () => {
    requireProject();
    const stranger = await signUpAndSignIn("Storage Usage Stranger");
    const asset = await upload("totalled.txt");

    // Parallel files add and delete projects, so both totals are read from one
    // snapshot.
    const { reports, instanceBytes } = await db.transaction(
      async (tx) => ({
        reports: await allUsageReports(tx),
        instanceBytes: await instanceUsedBytes(tx),
      }),
      { isolationLevel: "repeatable read" }
    );
    const project = reports.find(
      (report) =>
        report.scopeKind === "project" &&
        report.scopeId === String(suite.projectId)
    );
    expect(project?.usedBytes).toBeGreaterThanOrEqual(asset.size);

    // Every project's counter, plus avatars. A stranger who uploaded nothing
    // adds nothing to it, and no file is counted through both scopes.
    const sumOfProjects = reports
      .filter((report) => report.scopeKind === "project")
      .reduce((total, report) => total + report.usedBytes, 0);
    expect(instanceBytes).toBeGreaterThanOrEqual(sumOfProjects);
    expect(await usageFor(userScope(stranger.userId))).toBe(0);
  });
});

/**
 * The counter is only as good as the paths that move it, and a path that
 * stores bytes without accounting for them is invisible until a total is
 * compared against disk. These read the source rather than exercising a route,
 * so a fifth upload path fails them the moment it is written.
 */
describe("every path that stores an upload accounts for it", () => {
  const sources = async () => {
    const entries = await readdir("src", { recursive: true });
    const files = entries.filter(
      (entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts")
    );
    return new Map(
      await Promise.all(
        files.map(
          async (file) => [file, await readFile(`src/${file}`, "utf8")] as const
        )
      )
    );
  };

  /** The functions that write uploaded bytes to storage. */
  const STORERS = ["storeUpload", "storeObjects"];

  /** The files that store an upload, which is everything but the storers' definitions. */
  const uploadCallers = (sourceText: Map<string, string>) =>
    [...sourceText].filter(([, text]) =>
      STORERS.some(
        (storer) =>
          new RegExp(`\\b${storer}\\(`).test(text) &&
          !new RegExp(`function ${storer}\\(`).test(text)
      )
    );

  /**
   * Exported functions whose own body moves a counter: the creators a caller
   * can rely on to account for what it stored. Read from the source so the list
   * cannot go stale.
   */
  const accountedCreators = (sourceText: Map<string, string>): string[] => {
    const names: string[] = [];
    for (const text of sourceText.values()) {
      const blocks = text.split(/^export (?:async )?function /m).slice(1);
      for (const block of blocks) {
        const name = /^(\w+)/.exec(block)?.[1];
        if (!name) continue;
        const body = block.split(/^export /m)[0]!;
        if (/\b(add|subtract)Usage\(/.test(body)) names.push(name);
      }
    }
    return names;
  };

  it("names an accounted creator or moves the counter itself", async () => {
    const sourceText = await sources();
    const creators = accountedCreators(sourceText);
    expect(creators).toContain("createAsset");

    const callers = uploadCallers(sourceText);
    for (const storer of STORERS) {
      expect(
        callers.some(([, text]) => new RegExp(`\\b${storer}\\(`).test(text))
      ).toBe(true);
    }

    const unaccounted = callers
      .filter(
        ([, text]) =>
          !/\b(add|subtract)Usage\(/.test(text) &&
          !creators.some((creator) => new RegExp(`\\b${creator}\\(`).test(text))
      )
      .map(([file]) => file);
    expect(unaccounted).toEqual([]);
  });

  it("checks the storage cap before it writes the bytes", async () => {
    const sourceText = await sources();
    const unchecked = uploadCallers(sourceText)
      .filter(([, text]) => !/\bassertStorageAllows\(/.test(text))
      .map(([file]) => file);
    expect(unchecked).toEqual([]);
  });
});
