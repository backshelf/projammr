import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { baseUrl, setupSuite, trustedOrigin } from "../../test/fixtures.js";
import { db } from "../index.js";
import { objects, repoObjects } from "../schema/objects.js";
import { withProjectPolicyForTest } from "./project-policy.js";
import { createOrGetRepo } from "./repos.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import {
  assertStorageAllows,
  limitFor,
  newRepoObjectScopes,
  projectScope,
  recomputeUsage,
  repoBytes,
  usageFor,
  userScope,
} from "./storage-usage.js";

const suite = setupSuite("Storage limits");
const { owner, requireProject, uploadAsset } = suite;

/**
 * The caps are in gigabytes, and a byte count divided by a power of two is
 * exact in a double, so a cap can be placed on any byte the test likes.
 */
const gigabytes = (bytes: number) => bytes / 1024 ** 3;

const uploadOf = (bytes: number, name = "capped.txt") => {
  const form = new FormData();
  form.append(
    "file",
    new File(["x".repeat(bytes)], name, { type: "text/plain" })
  );
  form.append("projectId", String(suite.projectId));

  return app.request(`${baseUrl}/assets/upload`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: trustedOrigin },
    body: form,
  });
};

afterEach(() => {
  restoreInstancePolicy();
});

describe("storage caps", () => {
  it("is unlimited while the policy sets neither cap", async () => {
    expect(await limitFor(projectScope(suite.projectId))).toBeNull();
    expect(await limitFor(userScope(owner.userId))).toBeNull();
  });

  it("takes the upload that exactly fills the project cap and refuses the next byte", async () => {
    requireProject();
    const used = await usageFor(projectScope(suite.projectId));
    const limit = used + 32;
    stubInstancePolicy({ limits: { projectCapGb: gigabytes(limit) } });
    expect(await limitFor(projectScope(suite.projectId))).toBe(limit);

    const filling = await uploadOf(32, "exactly-full.txt");
    expect(filling.status).toBe(201);
    expect(await usageFor(projectScope(suite.projectId))).toBe(limit);

    const overflowing = await uploadOf(1, "one-too-many.txt");
    expect(overflowing.status).toBe(413);
    expect(await overflowing.json()).toMatchObject({
      code: "storage_limit",
      error: "This project is at its storage limit",
      details: { scopeKind: "project", usedBytes: limit, limitBytes: limit },
    });
  });

  it("refuses an upload that would pass the account's own cap", async () => {
    requireProject();
    const used = await usageFor(userScope(owner.userId));
    stubInstancePolicy({ limits: { userCapGb: gigabytes(used + 4) } });

    const res = await uploadOf(5, "over-the-account.txt");
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: "storage_limit",
      error: "Your account is at its storage limit",
      details: { scopeKind: "user", usedBytes: used },
    });
  });

  it("refuses a push of a new object that would pass the cap its repo objects have filled", async () => {
    requireProject();
    const { repo } = await createOrGetRepo(
      suite.projectId,
      "capped",
      owner.userId
    );
    const held = randomUUID().replaceAll("-", "");
    await db.insert(objects).values({ hash: held, kind: 0, size: 40 });
    await db.insert(repoObjects).values({
      repoId: repo.id,
      objectHash: held,
      pushedBy: owner.userId,
    });

    try {
      await recomputeUsage([
        projectScope(suite.projectId),
        userScope(owner.userId),
      ]);
      const used = await usageFor(projectScope(suite.projectId));
      expect(await repoBytes(suite.projectId)).toBe(40);
      stubInstancePolicy({ limits: { projectCapGb: gigabytes(used + 10) } });

      const fresh = randomUUID().replaceAll("-", "");
      const scopes = await newRepoObjectScopes(
        db,
        repo.id,
        fresh,
        owner.userId
      );

      await expect(assertStorageAllows(scopes, 11)).rejects.toMatchObject({
        status: 413,
        code: "storage_limit",
        details: { scopeKind: "project", usedBytes: used },
      });
      await assertStorageAllows(scopes, 10);

      // An object the project already holds adds nothing, so nothing is refused.
      const again = await newRepoObjectScopes(db, repo.id, held, owner.userId);
      expect(again).toEqual([]);
      await assertStorageAllows(again, 1_000);
    } finally {
      await db.delete(repoObjects).where(eq(repoObjects.objectHash, held));
      await db.delete(objects).where(eq(objects.hash, held));
      await recomputeUsage([
        projectScope(suite.projectId),
        userScope(owner.userId),
      ]);
    }
  });

  it("refuses to queue a conversion with no allowance left", async () => {
    requireProject();
    const asset = await uploadAsset("convertible.wav");
    stubInstancePolicy({
      limits: {
        projectCapGb: gigabytes(await usageFor(projectScope(suite.projectId))),
      },
    });

    const res = await app.request(`${baseUrl}/assets/${asset.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ format: ".mp3" }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "storage_limit" });
  });
});

describe("a project's own storage cap", () => {
  /** A project cap in the policy's gigabytes, exact for any byte count. */
  const capGb = (bytes: number) => bytes / 1024 ** 3;
  const scope = () => projectScope(suite.projectId);

  it("holds the project to its own cap where that is below the instance's", async () => {
    requireProject();
    const used = await usageFor(scope());
    stubInstancePolicy({ limits: { projectCapGb: gigabytes(used + 1024) } });

    await withProjectPolicyForTest(
      suite.projectId,
      { audio: { storageCapGb: capGb(used + 16) } },
      async () => {
        expect(await limitFor(scope())).toBe(used + 16);

        expect((await uploadOf(16, "fills-project-cap.txt")).status).toBe(201);
        const overflowing = await uploadOf(1, "past-project-cap.txt");
        expect(overflowing.status).toBe(413);
        expect(await overflowing.json()).toMatchObject({
          code: "storage_limit",
          details: { scopeKind: "project", limitBytes: used + 16 },
        });
      }
    );
  });

  it("keeps the instance's cap where the project's is above it or unset", async () => {
    requireProject();
    const used = await usageFor(scope());
    stubInstancePolicy({ limits: { projectCapGb: gigabytes(used + 64) } });

    const above = await withProjectPolicyForTest(
      suite.projectId,
      { audio: { storageCapGb: capGb(used + 4096) } },
      () => limitFor(scope())
    );
    expect(above).toBe(used + 64);
    expect(await limitFor(scope())).toBe(used + 64);
  });

  it("caps the project by its own cap on an instance that sets none", async () => {
    requireProject();
    const used = await usageFor(scope());

    const limit = await withProjectPolicyForTest(
      suite.projectId,
      { audio: { storageCapGb: capGb(used + 8) } },
      () => limitFor(scope())
    );
    expect(limit).toBe(used + 8);
    expect(await limitFor(userScope(owner.userId))).toBeNull();
  });
});
