import { readFileSync } from "node:fs";
import type { SaveMeta } from "@workspace/api/api";
import type { ApiClient } from "@workspace/api/lib/api-client";
import { objectRecord, packOf, type PackRecord } from "@workspace/dit/pack";
import { buildObjects } from "@workspace/dit/test-pack";
import { must } from "./api";
import type { HistoricSave } from "./session-history";

/**
 * The set every save of the demo stands on. The owner's real set never enters
 * the repository, so the hub holds a committed fixture in its place: its
 * download, restore and archive give back a real, openable `.als`, though one
 * that does not match the demo's tracks. Only `meta` (and the session's own
 * columns) say what the demo's set holds.
 */
const FIXTURE = new URL(
  "../../dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project/Arranged Set.als",
  import.meta.url
);
const LEAVES = 3;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** A well-formed object hash that is the same for the same label on every run. */
export const hashOf = (label: string) =>
  new Bun.CryptoHasher("sha256").update(label).digest("hex");

/** The objects every save of the demo rebuilds from: the stand-in set as dit lays it out. */
export interface StandInSet {
  records: PackRecord[];
  /** The ids of the tree and of the side list, which a save names. */
  tree: string;
  side: string;
  /** Every object's id, which each save and commit lists. */
  objects: string[];
  xmlHash: string;
}

export function standInSet(): StandInSet {
  const xml = new Uint8Array(Bun.gunzipSync(readFileSync(FIXTURE)));
  const size = Math.ceil(xml.byteLength / LEAVES);
  const built = buildObjects(
    Array.from({ length: LEAVES }, (_, i) =>
      xml.subarray(i * size, (i + 1) * size)
    )
  );
  const records = built.objects.map(({ body, kind }) =>
    objectRecord(body, kind)
  );
  return {
    records,
    tree: hex(built.treeId),
    side: hex(built.sideId),
    objects: records.map((record) => record.hash),
    xmlHash: hashOf(hex(xml)),
  };
}

const MINUTE = 60_000;

/** The shortest and longest a sitting is taken to have run before the save that ended it. */
const SITTING_MIN = 40 * MINUTE;
const SITTING_SPREAD = 110 * MINUTE;

/** One save as the hub takes it between commits. */
export interface PushedSave {
  hash: string;
  xmlHash: string;
  tree: string;
  side: string;
  fileUpdatedAt: number;
  machineName: string;
  meta: SaveMeta;
  viewOnly: false;
  unreadable: false;
}

/** One commit as the hub takes it: the saves it holds, each with the objects it rebuilds from. */
export interface PushedCommit {
  hash: string;
  saveHash: string;
  parentHash: string | null;
  message: string;
  kind: "user";
  committedAt: number;
  machineName: string;
  saves: { hash: string; objects: string[] }[];
}

/** A span the set was open, as the hub takes it. */
export interface PushedSegment {
  branch: string;
  machineName: string;
  startedAt: number;
  endedAt: number;
  source: "saves";
}

/**
 * What a session's history sends to the hub: its saves, the commits that
 * close at each milestone, and the time the set was open before each save.
 */
export interface PushPlan {
  saves: PushedSave[];
  commits: PushedCommit[];
  segments: PushedSegment[];
}

/** `saves` oldest first, the last of them a milestone. */
export function planPush(
  key: string,
  machineName: string,
  saves: HistoricSave[],
  set: StandInSet
): PushPlan {
  const pushed = saves.map((save): PushedSave => ({
    hash: hashOf(`${key} save ${save.fileUpdatedAt}`),
    xmlHash: set.xmlHash,
    tree: set.tree,
    side: set.side,
    fileUpdatedAt: save.fileUpdatedAt,
    machineName,
    meta: save.meta,
    viewOnly: false,
    unreadable: false,
  }));

  // A commit holds the saves since the one before it, up to a milestone.
  const commits: PushedCommit[] = [];
  let covered: PushedCommit["saves"] = [];
  saves.forEach((save, i) => {
    const own = pushed[i]!;
    covered.push({ hash: own.hash, objects: set.objects });
    if (save.kind !== "milestone") return;
    commits.push({
      hash: hashOf(`${key} commit ${save.fileUpdatedAt}`),
      saveHash: own.hash,
      parentHash: commits.at(-1)?.hash ?? null,
      message: save.message,
      kind: "user",
      committedAt: save.fileUpdatedAt + 1,
      machineName,
      saves: covered,
    });
    covered = [];
  });
  if (covered.length)
    throw new Error(`${key}: the last save is not a milestone to commit`);

  // Each save ends a sitting that began after the save before it.
  const segments = saves.map((save, i): PushedSegment => ({
    branch: "main",
    machineName,
    startedAt: Math.max(
      saves[i - 1]?.fileUpdatedAt ?? 0,
      save.fileUpdatedAt - SITTING_MIN - ((i * 37) % 11) * (SITTING_SPREAD / 10)
    ),
    endedAt: save.fileUpdatedAt,
    source: "saves",
  }));

  return { saves: pushed, commits, segments };
}

/** The request body of `POST /repos/:id/saves` is cut into runs of this many. */
const SAVES_PER_PUSH = 200;

/**
 * Pushes a session's history to its set in the repo as dit would: the
 * objects the hub lacks, the saves, the commits, then the time spans, each as
 * `machineId`. The set is already adopted and `machineId` already beat.
 */
export async function pushHistory(
  api: ApiClient,
  repoId: number,
  ditSetId: string,
  machineId: string,
  plan: PushPlan,
  set: StandInSet
) {
  const params = { path: { id: String(repoId) } };
  const headers = { "X-Machine-Id": machineId };

  const { missing } = must(
    await api.POST("/api/repos/{id}/objects/missing", {
      params,
      body: { hashes: set.objects },
    }),
    "missing objects"
  );
  if (missing.length) {
    const wanted = new Set(missing);
    const pack = packOf(...set.records.filter((r) => wanted.has(r.hash)));
    must(
      await api.POST("/api/repos/{id}/objects", {
        params,
        body: pack as unknown as string,
        bodySerializer: () => pack,
        headers: { "Content-Type": "application/octet-stream" },
      }),
      "object pack"
    );
  }

  for (let i = 0; i < plan.saves.length; i += SAVES_PER_PUSH) {
    must(
      await api.POST("/api/repos/{id}/saves", {
        params,
        headers,
        body: {
          ditSetId,
          branch: "main",
          saves: plan.saves.slice(i, i + SAVES_PER_PUSH),
        },
      }),
      "saves"
    );
  }
  must(
    await api.POST("/api/repos/{id}/commits", {
      params,
      headers,
      body: { ditSetId, branch: "main", commits: plan.commits },
    }),
    "commits"
  );
  must(
    await api.POST("/api/repos/{id}/segments", {
      params,
      headers,
      body: { ditSetId, segments: plan.segments },
    }),
    "segments"
  );
}
