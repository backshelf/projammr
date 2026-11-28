import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ENTITIES } from "../../entities/index.js";
import { instancePolicy } from "../../lib/instance-policy.js";
import type { PushMachine } from "../../lib/push-machine.js";
import { db } from "../index.js";
import { collectionTracks } from "../schema/collections.js";
import { machines } from "../schema/machines.js";
import {
  branches,
  commits,
  type Repo,
  repoMachines,
  repoSchema,
  repos,
} from "../schema/repos.js";
import { sessions } from "../schema/sessions.js";
import { isUniqueViolation } from "../unique-violation.js";
import type { ProjectResolution } from "./authorization.js";
import {
  setSessionLocalFilepath,
  upsertRepoMachinePath,
} from "./repo-paths.js";
import { emptyRepoStorage, repoStorages } from "./storage-usage.js";

const rowId = z.number().int().positive();

/** One adopted set: the id dit knows it by and the session that holds it. */
export const repoSetSchema = z.object({
  ditSetId: z.string(),
  sessionId: rowId,
});

/** A branch's newest commit: enough to name it and to download its set. */
const branchTipSchema = z.object({
  commitId: rowId,
  message: z.string(),
  committedAt: z.date(),
});

const repoBranchSchema = z.object({
  name: z.string(),
  tip: branchTipSchema.nullable(),
});

/** An adopted set as the repo reads show it: its session by name, its branches by tip. */
const repoSetDetailSchema = repoSetSchema.extend({
  sessionName: z.string(),
  localFilepath: z.string().nullable(),
  branches: z.array(repoBranchSchema),
});

/** One machine's local folder path for a repo. */
const repoMachinePathSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  path: z.string(),
  updatedAt: z.date(),
});

/**
 * The machine that made a repo's last push, as its page names it: the account
 * it belongs to rides along so a client can tell the viewer's own from
 * another's, and `removed` that the machine has since been removed, so it has
 * no Devices row to open. Null when the push named no machine of the pusher's.
 */
const lastPushMachineSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    userId: z.string(),
    removed: z.boolean(),
  })
  .nullable();

/**
 * A repo as the hub reads it, the one shape every repo read and
 * `PATCH /repos/:id` answers. `pushSamples` is the effective setting: the
 * repo's own switch, or on whenever the instance forces it (`pushSamplesForced`,
 * which also locks the switch). `storage` is what the repo's links hold.
 */
export const repoWithSetsSchema = repoSchema
  .omit({ lastPushMachineId: true })
  .extend({
    lastPushMachine: lastPushMachineSchema,
    localPath: z.string().nullable(),
    localPaths: z.array(repoMachinePathSchema),
    sets: z.array(repoSetDetailSchema),
    pushSamplesForced: z.boolean(),
    storage: z.object({
      setBytes: z.number(),
      sampleBytes: z.number(),
      sharedBytes: z.number(),
    }),
  });

export type RepoWithSets = z.infer<typeof repoWithSetsSchema>;

const localPathSchema = z.string().trim().min(1).max(4096);

export const newRepoSchema = z.object({
  name: z.string().trim().min(1).max(200),
  localPath: localPathSchema.optional(),
});

/** A Live set's file name without its `.als` extension: the session's name. */
const setNameOf = (fileName: string) => fileName.replace(/\.als$/i, "");

export const adoptSetBodySchema = z
  .object({
    ditSetId: z.string().trim().min(1),
    fileName: z
      .string()
      .trim()
      .refine((name) => setNameOf(name).length > 0, "File name is empty"),
    sessionId: rowId.optional(),
    trackId: rowId.optional(),
    localPath: localPathSchema.optional(),
    localFilepath: localPathSchema.optional(),
    /** Logs no activity for a session the set creates: a backfill adopts hundreds. */
    quiet: z.boolean().optional(),
  })
  .refine((body) => body.sessionId == null || body.trackId == null, {
    message: "Name a session to link or a track to create on, not both",
    path: ["trackId"],
  });

export type AdoptSetBody = z.infer<typeof adoptSetBodySchema>;

/** Resolver for `authorizeProject`: a repo names the project it belongs to. */
export async function projectIdForRepo(id: number): Promise<ProjectResolution> {
  const [row] = await db
    .select({ projectId: repos.projectId })
    .from(repos)
    .where(eq(repos.id, id));

  return row?.projectId ?? null;
}

/**
 * The adopted sets of each repo, keyed by repo id, in the order they were
 * adopted. One read: sessions left-joined to their branches and each branch's
 * head commit, so a set costs no round trip of its own. A set with no branch
 * yet has an empty `branches`; `main` sorts first.
 */
async function setsByRepo(
  repoIds: readonly number[]
): Promise<Map<number, RepoWithSets["sets"]>> {
  const byRepo = new Map<number, RepoWithSets["sets"]>();
  if (repoIds.length === 0) return byRepo;

  const rows = await db
    .select({
      repoId: sessions.repoId,
      ditSetId: sessions.ditSetId,
      sessionId: sessions.id,
      sessionName: sessions.name,
      localFilepath: sessions.localFilepath,
      branchName: branches.name,
      commitId: commits.id,
      message: commits.message,
      committedAt: commits.committedAt,
    })
    .from(sessions)
    .leftJoin(branches, eq(branches.sessionId, sessions.id))
    .leftJoin(commits, eq(commits.id, branches.headCommitId))
    .where(
      and(inArray(sessions.repoId, [...repoIds]), isNotNull(sessions.ditSetId))
    )
    .orderBy(
      asc(sessions.id),
      sql`(${branches.name} <> 'main')`,
      asc(branches.name)
    );

  const setOf = new Map<number, RepoWithSets["sets"][number]>();
  for (const row of rows) {
    const { repoId, ditSetId, sessionId } = row;
    if (repoId == null || ditSetId == null) continue;
    let set = setOf.get(sessionId);
    if (!set) {
      set = {
        ditSetId,
        sessionId,
        sessionName: row.sessionName,
        localFilepath: row.localFilepath,
        branches: [],
      };
      setOf.set(sessionId, set);
      const sets = byRepo.get(repoId) ?? [];
      sets.push(set);
      byRepo.set(repoId, sets);
    }
    if (row.branchName != null) {
      set.branches.push({
        name: row.branchName,
        tip:
          row.commitId == null
            ? null
            : {
                commitId: row.commitId,
                message: row.message!,
                committedAt: row.committedAt!,
              },
      });
    }
  }
  return byRepo;
}

/** The machines the repos' last pushes name, by machine id. */
async function lastPushMachines(
  rows: Repo[]
): Promise<Map<string, NonNullable<RepoWithSets["lastPushMachine"]>>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.lastPushMachineId ? [row.lastPushMachineId] : []
      )
    ),
  ];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({
      id: machines.id,
      name: machines.name,
      userId: machines.userId,
      removedAt: machines.removedAt,
    })
    .from(machines)
    .where(inArray(machines.id, ids));
  return new Map(
    found.map(({ removedAt, ...machine }) => [
      machine.id,
      { ...machine, removed: removedAt !== null },
    ])
  );
}

/** Every recorded per-machine folder path for `repoIds`, newest first per repo. */
async function repoPathsByRepo(
  repoIds: readonly number[]
): Promise<Map<number, RepoWithSets["localPaths"]>> {
  const byRepo = new Map<number, RepoWithSets["localPaths"]>();
  if (repoIds.length === 0) return byRepo;
  const rows = await db
    .select({
      repoId: repoMachines.repoId,
      machineId: repoMachines.machineId,
      machineName: machines.name,
      path: repoMachines.localPath,
      updatedAt: repoMachines.updatedAt,
    })
    .from(repoMachines)
    .innerJoin(machines, eq(machines.id, repoMachines.machineId))
    .where(inArray(repoMachines.repoId, [...repoIds]))
    .orderBy(desc(repoMachines.updatedAt), asc(repoMachines.machineId));
  for (const row of rows) {
    const list = byRepo.get(row.repoId) ?? [];
    list.push({
      machineId: row.machineId,
      machineName: row.machineName,
      path: row.path,
      updatedAt: row.updatedAt,
    });
    byRepo.set(row.repoId, list);
  }
  return byRepo;
}

async function withSets(rows: Repo[]): Promise<RepoWithSets[]> {
  const ids = rows.map((row) => row.id);
  const [sets, storage, pushers, paths] = await Promise.all([
    setsByRepo(ids),
    repoStorages(ids),
    lastPushMachines(rows),
    repoPathsByRepo(ids),
  ]);
  const forced = instancePolicy().limits.pushSamplesEverywhere;
  return rows.map(({ lastPushMachineId, ...row }) => {
    const localPaths = paths.get(row.id) ?? [];
    const preferred =
      (lastPushMachineId
        ? localPaths.find((entry) => entry.machineId === lastPushMachineId)
        : undefined) ?? localPaths[0];
    return {
      ...row,
      lastPushMachine: lastPushMachineId
        ? (pushers.get(lastPushMachineId) ?? null)
        : null,
      localPath: preferred?.path ?? null,
      localPaths,
      pushSamples: forced || row.pushSamples,
      pushSamplesForced: forced,
      sets: sets.get(row.id) ?? [],
      storage: storage.get(row.id) ?? emptyRepoStorage(),
    };
  });
}

/**
 * Makes `name` a repo of the project, or returns the one that already has that
 * name. `created` says which.
 */
export async function createOrGetRepo(
  projectId: number,
  name: string,
  userId: string,
  opts?: { machine?: PushMachine | null; localPath?: string }
): Promise<{ repo: RepoWithSets; created: boolean }> {
  const [inserted] = await db
    .insert(repos)
    .values({ projectId, name, createdBy: userId })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    if (opts?.machine && opts.localPath) {
      await upsertRepoMachinePath(
        db,
        inserted.id,
        opts.machine.id,
        opts.localPath
      );
    }
    const [repo] = await withSets([inserted]);
    return { repo: repo!, created: true };
  }

  const [existing] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.projectId, projectId), eq(repos.name, name)));
  if (!existing) {
    throw new HTTPException(409, {
      message: "Repo was removed while it was being created",
    });
  }
  if (opts?.machine && opts.localPath) {
    await upsertRepoMachinePath(
      db,
      existing.id,
      opts.machine.id,
      opts.localPath
    );
  }
  const [repo] = await withSets([existing]);
  return { repo: repo!, created: false };
}

/** Every repo of the project, oldest first, each with its adopted sets. */
export async function listRepos(projectId: number): Promise<RepoWithSets[]> {
  const rows = await db
    .select()
    .from(repos)
    .where(eq(repos.projectId, projectId))
    .orderBy(asc(repos.id));
  return withSets(rows);
}

/**
 * The repos holding a set whose session sits on the track, each in full (all
 * its sets, not only the track's), oldest first.
 */
export async function listReposForTrack(
  trackId: number
): Promise<RepoWithSets[]> {
  return withSets(await reposHoldingSessions(eq(sessions.trackId, trackId)));
}

/** The repos holding a set whose session sits on one of the collection's tracks. */
export async function listReposForCollection(
  collectionId: number
): Promise<RepoWithSets[]> {
  return withSets(
    await reposHoldingSessions(
      inArray(
        sessions.trackId,
        db
          .select({ id: collectionTracks.trackId })
          .from(collectionTracks)
          .where(eq(collectionTracks.collectionId, collectionId))
      )
    )
  );
}

async function reposHoldingSessions(sessionFilter: SQL): Promise<Repo[]> {
  return db
    .select()
    .from(repos)
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(sessions)
          .where(
            and(
              eq(sessions.repoId, repos.id),
              isNotNull(sessions.ditSetId),
              sessionFilter
            )
          )
      )
    )
    .orderBy(asc(repos.id));
}

export async function getRepo(id: number): Promise<RepoWithSets> {
  const [row] = await db.select().from(repos).where(eq(repos.id, id));
  if (!row) throw new HTTPException(404, { message: "Repo not found" });
  const [repo] = await withSets([row]);
  return repo!;
}

export const patchRepoSchema = z.object({ pushSamples: z.boolean() });

/**
 * Stores the repo's push-samples switch and answers the repo. While the
 * instance forces samples on, the switch is locked on and turning it off is
 * a 409; turning it on is stored, so it stays on if the instance stops forcing.
 */
export async function setPushSamples(
  id: number,
  pushSamples: boolean
): Promise<RepoWithSets> {
  if (!pushSamples && instancePolicy().limits.pushSamplesEverywhere) {
    throw new HTTPException(409, {
      message: "Push samples is on for every repository on this instance",
    });
  }
  const [row] = await db
    .update(repos)
    .set({ pushSamples })
    .where(eq(repos.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: "Repo not found" });
  const [repo] = await withSets([row]);
  return repo!;
}

/** The session holding the set `ditSetId` of the repo, if it was adopted. */
export async function sessionOfSet(
  repoId: number,
  ditSetId: string
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.repoId, repoId), eq(sessions.ditSetId, ditSetId)));
  return row?.id;
}

const setTaken = () =>
  new HTTPException(409, {
    message: "Session already belongs to a repo set",
  });

/**
 * Gives the existing session `sessionId` the set's identity, if it has none and
 * is still in the repo's project. Null when it has one already, when another
 * session took this set first, or when a move took the session out of the
 * project.
 */
async function linkSession(
  repo: { id: number; projectId: number },
  ditSetId: string,
  sessionId: number
): Promise<number | null> {
  try {
    const [row] = await db
      .update(sessions)
      .set({ repoId: repo.id, ditSetId })
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.projectId, repo.projectId),
          isNull(sessions.repoId)
        )
      )
      .returning({ id: sessions.id });
    return row?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * Adopts one set into the repo. A set already adopted gives back its session.
 * Otherwise the body's `sessionId` is linked, which must be a session of the
 * project that no repo holds yet, or a session is created for the set on
 * `trackId` the way `POST /sessions` would. `created` is true only for the
 * session this call made.
 */
export async function adoptSet(
  repo: { id: number; projectId: number },
  userId: string,
  body: AdoptSetBody,
  machine?: PushMachine | null
): Promise<{ sessionId: number; ditSetId: string; created: boolean }> {
  const { ditSetId, sessionId } = body;
  if (body.localPath && machine) {
    await upsertRepoMachinePath(db, repo.id, machine.id, body.localPath);
  }
  const adopted = async (id: number, created = false) => {
    if (body.localFilepath) {
      await setSessionLocalFilepath(
        db,
        id,
        repo.projectId,
        body.localFilepath,
        machine?.name ?? null
      );
    }
    return {
      sessionId: id,
      ditSetId,
      created,
    };
  };

  const held = await sessionOfSet(repo.id, ditSetId);
  if (held != null) {
    if (sessionId != null && sessionId !== held) throw setTaken();
    return adopted(held);
  }

  if (sessionId != null) {
    await ENTITIES.session.assertInProject([sessionId], repo.projectId);
    const linked = await linkSession(repo, ditSetId, sessionId);
    if (linked != null) return adopted(linked);

    // A racing adoption of this very set by this very session is the
    // idempotent case.
    if ((await sessionOfSet(repo.id, ditSetId)) === sessionId) {
      return adopted(sessionId);
    }
    // A session a move took out of the project answers like a foreign one;
    // otherwise it or the set is held already.
    await ENTITIES.session.assertInProject([sessionId], repo.projectId);
    throw setTaken();
  }

  const data = {
    name: setNameOf(body.fileName),
    daw: "ableton",
    dawName: "Ableton Live",
    projectId: repo.projectId,
    trackId: body.trackId,
    repoId: repo.id,
    ditSetId,
  };
  await ENTITIES.session.assertWritable(data, repo.projectId);
  try {
    const row = await ENTITIES.session.create(data, { userId });
    return adopted(row.id, true);
  } catch (error) {
    // `createSession` reports every unique conflict as a 409, among them a
    // second adoption of this set that won the race.
    if (error instanceof HTTPException && error.status === 409) {
      const raced = await sessionOfSet(repo.id, ditSetId);
      if (raced != null) return adopted(raced);
    }
    throw error;
  }
}
