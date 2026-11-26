import { createHash, randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { chunk } from "../lib/chunk.js";
import { objects, repoObjects } from "../db/schema/objects.js";
import { removeObjects } from "./dit-objects.js";
import type { Caller, Suite } from "./fixtures.js";

/**
 * Told apart per test process, so one file removing the objects it seeded
 * never takes a hash another file, running beside it, has also seeded.
 */
const PROCESS_SALT = randomUUID();

/** A well-formed object hash that is the same for the same label within one test process. */
export const hashOf = (label: string) =>
  createHash("sha256").update(`${PROCESS_SALT} ${label}`).digest("hex");

/** One save as dit pushes it, `at` being its file time in epoch milliseconds. */
export function savePayload(
  label: string,
  at: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    hash: hashOf(`save-${label}`),
    xmlHash: hashOf(`xml-${label}`),
    tree: hashOf(`tree-${label}`),
    side: hashOf(`side-${label}`),
    fileUpdatedAt: at,
    machineName: "studio",
    meta: null as Record<string, unknown> | null,
    viewOnly: false,
    unreadable: false,
    ...overrides,
  };
}

export type SavePayload = ReturnType<typeof savePayload>;

/** The objects a save rebuilds from. */
export const objectsOf = (save: SavePayload) => [save.tree, save.side];

/** A commit covering `saves`, the last of which is its own. */
export function commitPayload(
  label: string,
  parentHash: string | null,
  saves: SavePayload[],
  overrides: Record<string, unknown> = {}
) {
  const own = saves.at(-1)!;
  return {
    hash: hashOf(`commit-${label}`),
    saveHash: own.hash,
    parentHash,
    message: label,
    kind: "user",
    committedAt: own.fileUpdatedAt + 1,
    machineName: "studio",
    saves: saves.map((save) => ({
      hash: save.hash,
      objects: objectsOf(save),
    })),
    ...overrides,
  };
}

export type DitSet = { repoId: number; ditSetId: string; sessionId: number };

/** A repo of its own with one adopted set, made through the routes. */
export async function adoptNewSet(
  suite: Suite,
  label: string
): Promise<DitSet> {
  const repo = await suite.request(
    "owner",
    `/projects/${suite.projectId}/repos`,
    { method: "POST", body: JSON.stringify({ name: label }) }
  );
  const { id: repoId } = await repo.json();

  const adopted = await suite.request("owner", `/repos/${repoId}/sets`, {
    method: "POST",
    body: JSON.stringify({
      ditSetId: `set-${label}`,
      fileName: `${label}.als`,
    }),
  });
  const { ditSetId, sessionId } = await adopted.json();
  return { repoId, ditSetId, sessionId };
}

/** Gives the repo the objects, as an upload of them would. */
async function seedObjects(repoId: number, userId: string, hashes: string[]) {
  for (const batch of chunk(hashes, 5_000)) {
    await db
      .insert(objects)
      .values(batch.map((hash) => ({ hash, kind: 1, size: 10 })))
      .onConflictDoNothing();
    await db
      .insert(repoObjects)
      .values(
        batch.map((objectHash) => ({ repoId, objectHash, pushedBy: userId }))
      )
      .onConflictDoNothing();
  }
}

/**
 * `seedObjects` for a file that cleans up after itself: the returned
 * `seedObjects` remembers every hash it is given, and `removeSeeded` (for an
 * `afterAll`) removes them, links included.
 */
export function trackSeeds() {
  const seeded = new Set<string>();
  return {
    seedObjects: (repoId: number, userId: string, hashes: string[]) => {
      for (const hash of hashes) seeded.add(hash);
      return seedObjects(repoId, userId, hashes);
    },
    removeSeeded: () => removeObjects([...seeded]),
  };
}

/** Registers a machine of the caller's by its first beat and answers its id. */
export async function registerMachine(
  suite: Suite,
  caller: Exclude<Caller, "anonymous">,
  name: string
): Promise<string> {
  const id = randomUUID();
  const res = await suite.request(caller, `/machines/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name,
      platform: "macOS",
      appVersion: "0.14.0",
      openSessionId: null,
      repoIds: [],
    }),
  });
  if (!res.ok) throw new Error(`registering machine ${name}: ${res.status}`);
  return id;
}

/** The machine "studio" each caller of a suite pushes as, registered on first use. */
const studios = new WeakMap<Suite, Map<string, Promise<string>>>();

/**
 * The `X-Machine-Id` header of a push by `caller`: the machine `machine`
 * names, by default the caller's machine "studio", which the pushes' own
 * `machineName` defaults to; `null` sends no header, as a dit that predates
 * machine ids would.
 */
export async function machineHeader(
  suite: Suite,
  caller: Exclude<Caller, "anonymous">,
  machine?: string | null
): Promise<Record<string, string>> {
  if (machine === null) return {};
  if (machine !== undefined) return { "X-Machine-Id": machine };
  let byCaller = studios.get(suite);
  if (!byCaller) {
    byCaller = new Map();
    studios.set(suite, byCaller);
  }
  let studio = byCaller.get(caller);
  if (!studio) {
    studio = registerMachine(suite, caller, "studio");
    byCaller.set(caller, studio);
  }
  return { "X-Machine-Id": await studio };
}

export const pushSaves = async (
  suite: Suite,
  set: DitSet,
  branch: string,
  saves: SavePayload[],
  caller: Exclude<Caller, "anonymous"> = "owner",
  machine?: string | null
) =>
  suite.request(caller, `/repos/${set.repoId}/saves`, {
    method: "POST",
    headers: await machineHeader(suite, caller, machine),
    body: JSON.stringify({ ditSetId: set.ditSetId, branch, saves }),
  });

/** A span of time the set was open, as dit pushes it. */
export type SegmentPayload = {
  branch: string;
  machineName: string;
  startedAt: number;
  endedAt: number;
  source: "script" | "log" | "title" | "saves";
};

export const pushSegments = async (
  suite: Suite,
  set: DitSet,
  segments: SegmentPayload[],
  caller: Exclude<Caller, "anonymous"> = "owner",
  machine?: string | null
) =>
  suite.request(caller, `/repos/${set.repoId}/segments`, {
    method: "POST",
    headers: await machineHeader(suite, caller, machine),
    body: JSON.stringify({ ditSetId: set.ditSetId, segments }),
  });

export const pushCommits = async (
  suite: Suite,
  set: DitSet,
  branch: string,
  commits: ReturnType<typeof commitPayload>[],
  caller: Exclude<Caller, "anonymous"> = "owner",
  machine?: string | null
) =>
  suite.request(caller, `/repos/${set.repoId}/commits`, {
    method: "POST",
    headers: await machineHeader(suite, caller, machine),
    body: JSON.stringify({ ditSetId: set.ditSetId, branch, commits }),
  });
