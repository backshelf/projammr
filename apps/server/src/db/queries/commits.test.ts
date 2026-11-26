import { afterAll, describe, expect, it } from "bun:test";
import { setupSuite } from "../../test/fixtures.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  savePayload,
  trackSeeds,
} from "../../test/dit-history.js";
import { getSessionBranches, getSessionCommits } from "./commits.js";

const suite = setupSuite("Session commits");
const { owner, requireProject } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);

const T0 = Date.UTC(2026, 5, 1);
const MINUTE = 60_000;

const hashes = (rows: { hash: string | null }[]) => rows.map((row) => row.hash);

describe("getSessionCommits", () => {
  it("derives each commit's saves from its branch between the parent's save and its own", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Derived saves");
    const a = savePayload("a", T0);
    const b = savePayload("b", T0 + MINUTE);
    const c = savePayload("c", T0 + 2 * MINUTE);
    const d = savePayload("d", T0 + 3 * MINUTE);
    const elsewhere = savePayload("other", T0 + MINUTE + 1);
    const trailing = savePayload("trailing", T0 + 10 * MINUTE);

    await pushSaves(suite, set, "main", [a, b, c, d, trailing]);
    await pushSaves(suite, set, "side", [elsewhere]);
    await seedObjects(
      set.repoId,
      owner.userId,
      [a, b, c, d].flatMap(objectsOf)
    );

    const first = commitPayload("c1", null, [a, b]);
    const second = commitPayload("c2", first.hash, [c, d]);
    expect(
      (await pushCommits(suite, set, "main", [first, second])).status
    ).toBe(201);

    const rows = await getSessionCommits(set.sessionId, 10);
    expect(rows.map((row) => row.hash)).toEqual([second.hash, first.hash]);
    expect(hashes(rows[1]!.saves)).toEqual([a.hash, b.hash]);
    expect(hashes(rows[0]!.saves)).toEqual([c.hash, d.hash]);
    expect(rows[0]).toMatchObject({
      branch: "main",
      parentHash: first.hash,
      saveHash: d.hash,
    });
    expect(rows[1]!.parentHash).toBeNull();
  });

  it("keeps each branch's commits to that branch's saves", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Two branches");
    const a = savePayload("a", T0);
    const b = savePayload("b", T0 + MINUTE);
    const c = savePayload("c", T0 + 2 * MINUTE);
    await pushSaves(suite, set, "main", [a, c]);
    await pushSaves(suite, set, "idea", [b]);
    await seedObjects(set.repoId, owner.userId, [a, b, c].flatMap(objectsOf));

    await pushCommits(suite, set, "main", [commitPayload("m", null, [a, c])]);
    await pushCommits(suite, set, "idea", [commitPayload("i", null, [b])]);

    const rows = await getSessionCommits(set.sessionId, 10);
    const byBranch = Object.fromEntries(
      rows.map((row) => [row.branch, hashes(row.saves)])
    );
    expect(byBranch).toEqual({ main: [a.hash, c.hash], idea: [b.hash] });
  });

  it("returns only the newest commits up to the limit", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Limited");
    const saves = [0, 1, 2].map((i) => savePayload(`s${i}`, T0 + i * MINUTE));
    await pushSaves(suite, set, "main", saves);
    await seedObjects(set.repoId, owner.userId, saves.flatMap(objectsOf));

    const chain: ReturnType<typeof commitPayload>[] = [];
    for (const [i, save] of saves.entries()) {
      chain.push(commitPayload(`c${i}`, chain.at(-1)?.hash ?? null, [save]));
    }
    await pushCommits(suite, set, "main", chain);

    const rows = await getSessionCommits(set.sessionId, 2);
    expect(rows.map((row) => row.hash)).toEqual([
      chain[2]!.hash,
      chain[1]!.hash,
    ]);
    expect(await getSessionCommits(set.sessionId + 100_000, 2)).toEqual([]);
  });
});

describe("getSessionBranches", () => {
  it("names each branch's head commit, null until it has one", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Heads");
    const a = savePayload("a", T0);
    await pushSaves(suite, set, "main", [a]);
    await pushSaves(suite, set, "idea", [savePayload("i", T0 + MINUTE)]);
    await seedObjects(set.repoId, owner.userId, objectsOf(a));
    const commit = commitPayload("c1", null, [a]);
    await pushCommits(suite, set, "main", [commit]);

    expect(await getSessionBranches(set.sessionId)).toEqual([
      { name: "main", headCommitHash: commit.hash },
      { name: "idea", headCommitHash: null },
    ]);
  });
});
