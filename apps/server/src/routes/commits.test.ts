import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { constants, zstdCompressSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { buildObjects } from "@workspace/dit/test-pack";
import { db } from "../db/index.js";
import { objects, repoObjects } from "../db/schema/objects.js";
import { commits } from "../db/schema/repos.js";
import { saves } from "../db/schema/saves.js";
import { objectKey, storedFilePath, storeObjects } from "../lib/storage.js";
import {
  adoptNewSet,
  commitPayload,
  pushCommits,
  pushSaves,
  savePayload,
  type DitSet,
} from "../test/dit-history.js";
import { setupSuite } from "../test/fixtures.js";
import { removeObjects } from "../test/dit-objects.js";

const suite = setupSuite("Commit set download");
const { owner, requireProject, request, expectAccess } = suite;

const T0 = Date.UTC(2026, 5, 1);

const FIXTURE_DIR =
  "../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project";

/** The XML of a real set, as the bytes dit would have split into leaves. */
const arrangedSetXml = new Uint8Array(
  Bun.gunzipSync(
    new Uint8Array(readFileSync(`${FIXTURE_DIR}/Arranged Set.als`))
  )
);

const hex = (id: Uint8Array) => Buffer.from(id).toString("hex");

const stored: string[] = [];
afterAll(() => removeObjects(stored));

/** Splits `bytes` into `count` contiguous leaves. */
function leavesOf(bytes: Uint8Array, count: number): Uint8Array[] {
  const size = Math.ceil(bytes.byteLength / count);
  return Array.from({ length: count }, (_, i) =>
    bytes.subarray(i * size, (i + 1) * size)
  );
}

/**
 * A repo with one commit whose save rebuilds from `leaves`: every object is
 * stored the way dit stores it (zstd level 3 of the kind byte and the body)
 * and linked to the save.
 */
async function commitOf(label: string, leaves: Uint8Array[]) {
  const set: DitSet = await adoptNewSet(suite, label);
  const built = buildObjects(leaves);
  const hashes = built.objects.map((object) => hex(object.id));
  stored.push(...hashes);

  await db
    .insert(objects)
    .values(
      built.objects.map((object) => ({
        hash: hex(object.id),
        kind: object.kind,
        size: object.body.byteLength,
      }))
    )
    .onConflictDoNothing();
  await db
    .insert(repoObjects)
    .values(
      hashes.map((objectHash) => ({
        repoId: set.repoId,
        objectHash,
        pushedBy: owner.userId,
      }))
    )
    .onConflictDoNothing();
  for (const object of built.objects) {
    const raw = Buffer.concat([Uint8Array.of(object.kind), object.body]);
    await storeObjects([
      {
        hash: hex(object.id),
        bytes: zstdCompressSync(raw, {
          params: { [constants.ZSTD_c_compressionLevel]: 3 },
        }),
      },
    ]);
  }

  const save = savePayload(label, T0, {
    tree: hex(built.treeId),
    side: hex(built.sideId),
  });
  const commit = {
    ...commitPayload(label, null, [save]),
    saves: [{ hash: save.hash, objects: hashes }],
  };
  expect((await pushSaves(suite, set, "main", [save])).status).toBe(200);
  const pushed = await pushCommits(suite, set, "main", [commit]);
  expect(pushed.status).toBe(201);

  const [row] = await db
    .select({ id: commits.id, saveId: commits.saveId })
    .from(commits)
    .where(eq(commits.repoId, set.repoId));
  return { ...row!, hashes };
}

describe("GET /commits/:id/set", () => {
  it("serves the set a commit holds, gzipped and named after its session", async () => {
    requireProject();
    const commit = await commitOf(
      "Download basic",
      leavesOf(arrangedSetXml, 4)
    );
    const path = `/commits/${commit.id}/set`;

    await expectAccess("GET", path, { viewer: 200, editor: 200, owner: 200 });

    const res = await request("viewer", path);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Download basic.als"'
    );
    const xml = Bun.gunzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.from(xml).equals(Buffer.from(arrangedSetXml))).toBe(true);
  });

  it("answers 404 for a commit that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/commits/2147483000/set");
    expect(res.status).toBe(404);
  });

  it("answers 409 naming the state when the save's content is not stored", async () => {
    requireProject();
    const commit = await commitOf("Download pruned", [
      new TextEncoder().encode("<pruned/>"),
    ]);
    await db
      .update(saves)
      .set({ contentState: "pruned" })
      .where(eq(saves.id, commit.saveId));

    const res = await request("owner", `/commits/${commit.id}/set`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("pruned");
  });

  it("answers 500 without any of the set when an object file is gone", async () => {
    requireProject();
    const commit = await commitOf("Download missing", [
      new TextEncoder().encode("<missing-a/>"),
      new TextEncoder().encode("<missing-b/>"),
    ]);
    await rm(storedFilePath(objectKey(commit.hashes[0]!)));

    const res = await request("owner", `/commits/${commit.id}/set`);
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.text()).not.toContain("missing-");
  });
});

describe("GET /saves/:id/set", () => {
  it("serves a stored save's set to any member and hides it from a stranger", async () => {
    requireProject();
    const commit = await commitOf("Save download", leavesOf(arrangedSetXml, 3));
    const path = `/saves/${commit.saveId}/set`;

    await expectAccess("GET", path, { viewer: 200, editor: 200, owner: 200 });

    const res = await request("viewer", path);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Save download.als"'
    );
    const xml = Bun.gunzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.from(xml).equals(Buffer.from(arrangedSetXml))).toBe(true);
  });

  it("answers 409 naming the state for a pruned save", async () => {
    requireProject();
    const commit = await commitOf("Save pruned", [
      new TextEncoder().encode("<pruned-save/>"),
    ]);
    await db
      .update(saves)
      .set({ contentState: "pruned" })
      .where(eq(saves.id, commit.saveId));

    const res = await request("owner", `/saves/${commit.saveId}/set`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("pruned");
  });

  it("answers 404 for a save that does not exist", async () => {
    requireProject();
    const res = await request("owner", "/saves/2147483000/set");
    expect(res.status).toBe(404);
  });
});
