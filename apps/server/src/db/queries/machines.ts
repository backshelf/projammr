import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../../lib/http.js";
import { db } from "../index.js";
import { authSessions, users } from "../schema/auth.js";
import { renderRejections } from "../schema/machine-rejections.js";
import {
  deviceIdSchema,
  type MachineBeat,
  MACHINE_OFFLINE_AFTER_MS,
  machines,
  type MachineView,
  type OpenOn,
  type PushedRepo,
} from "../schema/machines.js";
import { members } from "../schema/projects.js";
import { commits, repos } from "../schema/repos.js";
import { saves } from "../schema/saves.js";
import { sessions } from "../schema/sessions.js";
import { isUniqueViolation } from "../unique-violation.js";
import { neverHereByMachine } from "./machine-rejections.js";
import { offsetOf } from "./pagination.js";

const MACHINE_NAME_CONSTRAINT = "machines_user_name";

const machineColumns = {
  id: machines.id,
  name: machines.name,
  platform: machines.platform,
  appVersion: machines.appVersion,
  lastSeenAt: machines.lastSeenAt,
  openSessionId: machines.openSessionId,
  repoIds: machines.repoIds,
};

const onlineSince = () => new Date(Date.now() - MACHINE_OFFLINE_AFTER_MS);

/** Keeps a read to the machines that were not removed. */
const live = isNull(machines.removedAt);

const isOnline = (lastSeenAt: Date, now: number) =>
  now - lastSeenAt.getTime() < MACHINE_OFFLINE_AFTER_MS;

const foreignMachine = () =>
  new HTTPException(403, {
    message: "This machine belongs to another account",
  });

/** What a client acts on as signed out: the machine was removed from the web. */
const removedMachine = () =>
  new HTTPException(401, { message: "This machine was removed" });

const notRegistered = () =>
  new ApiError(409, {
    code: "machine_not_registered",
    message:
      "This machine is not registered with the hub. Update dit and sign in again.",
  });

const nameTaken = () =>
  new ApiError(409, {
    code: "machine_name_taken",
    message: "You already have a machine with this name",
  });

/**
 * Refuses an id the caller cannot beat as: another account's machine is a 403,
 * and one of the caller's own that was removed a 401, the answer a signed-out
 * client acts on. An id no machine holds passes: a beat registers it.
 */
export async function assertMachineAvailable(
  id: string,
  userId: string
): Promise<void> {
  const [row] = await db
    .select({ userId: machines.userId, removedAt: machines.removedAt })
    .from(machines)
    .where(eq(machines.id, id));
  if (!row) return;
  if (row.userId !== userId) throw foreignMachine();
  if (row.removedAt !== null) throw removedMachine();
}

/**
 * The machine a push names in its `X-Machine-Id` header, which must be a live
 * one of the caller's: another account's is a 403, a removed one a 401, and an
 * id no machine holds (or none sent, as an older dit does) a 409
 * `machine_not_registered`.
 */
export async function pushingMachine(
  header: string | undefined,
  userId: string
): Promise<{ id: string; name: string }> {
  const id = deviceIdSchema.safeParse(header);
  if (!id.success) throw notRegistered();
  const [row] = await db
    .select({
      id: machines.id,
      name: machines.name,
      userId: machines.userId,
      removedAt: machines.removedAt,
    })
    .from(machines)
    .where(eq(machines.id, id.data));
  if (!row) throw notRegistered();
  if (row.userId !== userId) throw foreignMachine();
  if (row.removedAt !== null) throw removedMachine();
  return { id: row.id, name: row.name };
}

/**
 * Resolves the `X-Machine-Id` header when present and registered to `userId`,
 * or returns `null` when absent or unregistered (routes like repo creation
 * and set adoption accept callers without a registered machine). Another
 * account's machine is still a 403 and a removed one a 401.
 */
export async function optionalPushingMachine(
  header: string | undefined,
  userId: string
): Promise<{ id: string; name: string } | null> {
  if (!header) return null;
  const id = deviceIdSchema.safeParse(header);
  if (!id.success) return null;
  const [row] = await db
    .select({
      id: machines.id,
      name: machines.name,
      userId: machines.userId,
      removedAt: machines.removedAt,
    })
    .from(machines)
    .where(eq(machines.id, id.data));
  if (!row) return null;
  if (row.userId !== userId) throw foreignMachine();
  if (row.removedAt !== null) throw removedMachine();
  return { id: row.id, name: row.name };
}

/** The session when `userId` is a member of its project, else null. */
async function openableSession(
  sessionId: number,
  userId: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(
      members,
      and(eq(members.projectId, sessions.projectId), eq(members.userId, userId))
    )
    .where(eq(sessions.id, sessionId));
  return row?.id ?? null;
}

/**
 * Records a beat from a machine. The first beat of an id registers it; later
 * beats update it and note the sign-in they came from, which a removal
 * revokes. The open session is kept only while the caller can read it.
 */
export async function recordMachineBeat(
  id: string,
  userId: string,
  beat: MachineBeat,
  authSessionId: string
): Promise<MachineView> {
  const openSessionId =
    beat.openSessionId === null
      ? null
      : await openableSession(beat.openSessionId, userId);
  const now = new Date();
  const values = {
    name: beat.name,
    platform: beat.platform,
    appVersion: beat.appVersion,
    lastSeenAt: now,
    openSessionId,
    repoIds: beat.repoIds,
    authSessionId,
  };

  let row:
    | Pick<
        MachineView,
        | "id"
        | "name"
        | "platform"
        | "appVersion"
        | "lastSeenAt"
        | "openSessionId"
      >
    | undefined;
  try {
    [row] = await db
      .insert(machines)
      .values({ id, userId, ...values })
      .onConflictDoUpdate({
        target: machines.id,
        set: values,
        setWhere: and(eq(machines.userId, userId), live),
      })
      .returning({
        id: machines.id,
        name: machines.name,
        platform: machines.platform,
        appVersion: machines.appVersion,
        lastSeenAt: machines.lastSeenAt,
        openSessionId: machines.openSessionId,
      });
  } catch (error) {
    if (isUniqueViolation(error, MACHINE_NAME_CONSTRAINT)) throw nameTaken();
    throw error;
  }
  // The update's guard matched no row: the id is another account's, or the
  // caller's own machine that was removed.
  if (!row) {
    await assertMachineAvailable(id, userId);
    throw foreignMachine();
  }
  return { ...row, online: true };
}

type MachineRow = {
  id: string;
  openSessionId: number | null;
  lastSeenAt: Date;
};

/**
 * The repos these machines have pushed to, by machine id, from the commits and
 * the saves attributed to them. Only repos of projects `userId` is a member of
 * are named, so a repo of a project the caller left is no longer listed.
 */
async function pushedReposOf(
  machineIds: readonly string[],
  userId: string
): Promise<Map<string, PushedRepo[]>> {
  const byMachine = new Map<string, PushedRepo[]>();
  if (machineIds.length === 0) return byMachine;
  const ids = [...machineIds];

  const [fromCommits, fromSaves] = await Promise.all([
    db
      .selectDistinct({ machineId: commits.machineId, repoId: commits.repoId })
      .from(commits)
      .where(inArray(commits.machineId, ids)),
    db
      .selectDistinct({ machineId: saves.machineId, repoId: sessions.repoId })
      .from(saves)
      .innerJoin(sessions, eq(sessions.id, saves.sessionId))
      .where(and(inArray(saves.machineId, ids), isNotNull(sessions.repoId))),
  ]);

  const pushedBy = new Map<string, Set<number>>();
  for (const { machineId, repoId } of [...fromCommits, ...fromSaves]) {
    if (machineId === null || repoId === null) continue;
    pushedBy.set(machineId, (pushedBy.get(machineId) ?? new Set()).add(repoId));
  }
  const repoIds = [...new Set([...pushedBy.values()].flatMap((s) => [...s]))];
  if (repoIds.length === 0) return byMachine;

  const readable = new Map(
    (
      await db
        .select({ id: repos.id, name: repos.name, projectId: repos.projectId })
        .from(repos)
        .innerJoin(
          members,
          and(
            eq(members.projectId, repos.projectId),
            eq(members.userId, userId)
          )
        )
        .where(inArray(repos.id, repoIds))
        .orderBy(asc(repos.name), asc(repos.id))
    ).map((repo) => [repo.id, repo])
  );
  for (const [machineId, pushed] of pushedBy) {
    byMachine.set(
      machineId,
      [...readable.values()].filter((repo) => pushed.has(repo.id))
    );
  }
  return byMachine;
}

/**
 * The sessions machines have open that `userId` may read, by id. A machine
 * that is offline reports none, and one is named only while the caller is
 * still a member of its project.
 */
async function openSessionsOf(
  rows: readonly MachineRow[],
  userId: string,
  now: number
): Promise<Map<number, { id: number; name: string; projectId: number }>> {
  const openable = rows.flatMap((row) =>
    row.openSessionId !== null && isOnline(row.lastSeenAt, now)
      ? [row.openSessionId]
      : []
  );
  if (openable.length === 0) return new Map();
  const found = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      projectId: sessions.projectId,
    })
    .from(sessions)
    .innerJoin(
      members,
      and(eq(members.projectId, sessions.projectId), eq(members.userId, userId))
    )
    .where(inArray(sessions.id, openable));
  return new Map(found.map((session) => [session.id, session]));
}

/** Machine rows with what a read adds to them: online, the open set, the repos pushed. */
async function describeMachines<T extends MachineRow>(
  rows: T[],
  userId: string
) {
  const now = Date.now();
  const [openSessions, pushed] = await Promise.all([
    openSessionsOf(rows, userId, now),
    pushedReposOf(
      rows.map((row) => row.id),
      userId
    ),
  ]);
  return rows.map((row) => {
    const online = isOnline(row.lastSeenAt, now);
    return {
      ...row,
      online,
      openSession:
        row.openSessionId === null || !online
          ? null
          : (openSessions.get(row.openSessionId) ?? null),
      pushedRepos: pushed.get(row.id) ?? [],
    };
  });
}

/** The caller's machines, most recently seen first. */
export async function listMachines(userId: string) {
  const rows = await db
    .select({ ...machineColumns })
    .from(machines)
    .where(and(eq(machines.userId, userId), live))
    .orderBy(desc(machines.lastSeenAt), asc(machines.id));
  const [described, neverHere] = await Promise.all([
    describeMachines(rows, userId),
    neverHereByMachine(rows.map((row) => row.id)),
  ]);
  return described.map((machine) => ({
    ...machine,
    neverHere: neverHere.get(machine.id) ?? [],
  }));
}

/** One page of every account's machines, most recently seen first, and how many there are. */
export async function listAdminMachines(page: number, pageSize: number) {
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: machines.id,
        name: machines.name,
        platform: machines.platform,
        appVersion: machines.appVersion,
        lastSeenAt: machines.lastSeenAt,
        owner: { id: users.id, name: users.name },
      })
      .from(machines)
      .innerJoin(users, eq(users.id, machines.userId))
      .where(live)
      .orderBy(desc(machines.lastSeenAt), asc(machines.id))
      .limit(pageSize)
      .offset(offsetOf(page, pageSize)),
    db.select({ value: count() }).from(machines).where(live),
  ]);
  return { items, total: total?.value ?? 0 };
}

/**
 * Removes one of the caller's machines: the row stays, marked removed, with
 * everything that names it, and the sign-in of its last beat is revoked so the
 * app is signed out. Another account's machine is refused with 403; an id no
 * live machine holds is a 404.
 */
export async function removeMachine(id: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .update(machines)
      .set({ removedAt: new Date(), openSessionId: null, repoIds: [] })
      .where(and(eq(machines.id, id), eq(machines.userId, userId), live))
      .returning({ authSessionId: machines.authSessionId });
    if (!removed) {
      const [held] = await tx
        .select({ userId: machines.userId })
        .from(machines)
        .where(eq(machines.id, id));
      throw held && held.userId !== userId
        ? foreignMachine()
        : new HTTPException(404, { message: "Machine not found" });
    }
    if (removed.authSessionId !== null) {
      await tx
        .delete(authSessions)
        .where(eq(authSessions.id, removed.authSessionId));
    }
    await tx.delete(renderRejections).where(eq(renderRejections.machineId, id));
  });
}

/**
 * The caller's machines online now, on one session: the ones opening it
 * first, then the ones tracking its repo, then the most recently seen.
 */
export async function sessionPresence(sessionId: number, userId: string) {
  const [session] = await db
    .select({ repoId: sessions.repoId })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) throw new HTTPException(404, { message: "Session not found" });

  const rows = await db
    .select({ ...machineColumns })
    .from(machines)
    .where(
      and(
        eq(machines.userId, userId),
        live,
        gt(machines.lastSeenAt, onlineSince())
      )
    );
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      tracksRepo:
        session.repoId !== null && row.repoIds.includes(session.repoId),
      openingThis: row.openSessionId === sessionId,
      lastSeenAt: row.lastSeenAt,
    }))
    .sort(
      (a, b) =>
        Number(b.openingThis) - Number(a.openingThis) ||
        Number(b.tracksRepo) - Number(a.tracksRepo) ||
        b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
    )
    .map(({ id, name, tracksRepo, openingThis }) => ({
      id,
      name,
      tracksRepo,
      openingThis,
    }));
}

/**
 * The online machine that has this session open, with its owner, for the
 * session page. The owner must still be a member of the session's project, so
 * a label outlives neither the machine's silence nor the owner's membership.
 */
export async function openOnFor(sessionId: number): Promise<OpenOn> {
  const [row] = await db
    .select({
      machine: machines.name,
      ownerId: users.id,
      ownerName: users.name,
    })
    .from(machines)
    .innerJoin(sessions, eq(sessions.id, machines.openSessionId))
    .innerJoin(
      members,
      and(
        eq(members.userId, machines.userId),
        eq(members.projectId, sessions.projectId)
      )
    )
    .innerJoin(users, eq(users.id, machines.userId))
    .where(
      and(
        eq(machines.openSessionId, sessionId),
        live,
        gt(machines.lastSeenAt, onlineSince())
      )
    )
    .orderBy(desc(machines.lastSeenAt))
    .limit(1);
  return row
    ? { machine: row.machine, owner: { id: row.ownerId, name: row.ownerName } }
    : null;
}

/**
 * The caller's machines for the MCP tool, most recently seen first. With
 * `projectId`, only those tracking a repo of that project. A machine's open
 * session is reported only while the machine is online and the caller is still
 * a member of that session's project, and its pushed repos only those of
 * projects the caller is a member of.
 */
export async function listMachineSummaries(userId: string, projectId?: number) {
  const rows = await db
    .select({ ...machineColumns })
    .from(machines)
    .where(and(eq(machines.userId, userId), live))
    .orderBy(desc(machines.lastSeenAt), asc(machines.id));

  let kept = rows;
  if (projectId !== undefined) {
    const projectRepos = new Set(
      (
        await db
          .select({ id: repos.id })
          .from(repos)
          .where(eq(repos.projectId, projectId))
      ).map((repo) => repo.id)
    );
    kept = rows.filter((row) => row.repoIds.some((id) => projectRepos.has(id)));
  }

  return (await describeMachines(kept, userId)).map((machine) => ({
    id: machine.id,
    name: machine.name,
    platform: machine.platform,
    appVersion: machine.appVersion,
    lastSeenAt: machine.lastSeenAt,
    online: machine.online,
    openSession: machine.openSession,
    pushedRepos: machine.pushedRepos,
  }));
}

/**
 * Rows of saves, commits or the like that name a machine by id, each showing
 * the name that machine has now in place of the one it was saved under, so a
 * renamed machine keeps its history under its new name. A row naming no
 * machine keeps its own name; a removed machine still names its rows.
 */
export async function withCurrentMachineNames<
  T extends { machineId: string | null; machineName: string | null },
>(rows: T[]): Promise<T[]> {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.machineId ? [row.machineId] : []))),
  ];
  if (ids.length === 0) return rows;
  const named = new Map(
    (
      await db
        .select({ id: machines.id, name: machines.name })
        .from(machines)
        .where(inArray(machines.id, ids))
    ).map((machine) => [machine.id, machine.name])
  );
  return rows.map((row) =>
    row.machineId === null
      ? row
      : { ...row, machineName: named.get(row.machineId) ?? row.machineName }
  );
}
