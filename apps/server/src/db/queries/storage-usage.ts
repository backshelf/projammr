import { and, eq, sql, type SQL } from "drizzle-orm";
import { ApiError } from "../../lib/http.js";
import { instancePolicy } from "../../lib/instance-policy.js";
import { db } from "../index.js";
import {
  storageUsage,
  type StorageReport,
  type StorageScopeKind,
} from "../schema/storage-usage.js";
import { projectPolicy } from "./project-policy.js";

/** Anything that can run a statement: the pool, or a transaction on it. */
type Executor = Pick<typeof db, "execute">;

/**
 * Whose bytes these are. A project's files and a user's uploads are two views
 * of the same storage, so most files count towards one of each.
 */
export type UsageScope =
  { kind: "project"; id: number } | { kind: "user"; id: string };

export const projectScope = (id: number): UsageScope => ({
  kind: "project",
  id,
});

export const userScope = (id: string): UsageScope => ({ kind: "user", id });

/**
 * The scopes a stored file counts towards: its project, where it has one, and
 * the account that put it there, where one is recorded. An avatar reaches only
 * the second; a spectrogram, which nobody uploaded, only the first.
 */
export function scopesOf(owner: {
  projectId?: number | null;
  userId?: string | null;
}): UsageScope[] {
  return [
    ...(owner.projectId == null ? [] : [projectScope(owner.projectId)]),
    ...(owner.userId == null ? [] : [userScope(owner.userId)]),
  ];
}

const scopeRows = (scopes: UsageScope[], bytes: number): SQL =>
  sql.join(
    scopes.map(
      (scope) =>
        sql`(${scope.kind}::storage_scope, ${String(scope.id)}, ${bytes}::bigint)`
    ),
    sql`, `
  );

/**
 * Moves every scope's counter by `bytes`, creating the rows that do not exist
 * yet. One statement, so it joins whatever transaction the row that owns the
 * bytes is being written in and cannot half-apply.
 *
 * The counter is clamped at zero: it is a cache of a sum that the audit
 * re-derives, and a negative total would misreport every scope it was compared
 * against until then.
 */
async function moveUsage(
  tx: Executor,
  scopes: UsageScope[],
  bytes: number
): Promise<void> {
  if (scopes.length === 0 || bytes === 0) return;

  await tx.execute(sql`
    insert into storage_usage (scope_kind, scope_id, bytes)
    values ${scopeRows(scopes, bytes)}
    on conflict (scope_kind, scope_id) do update
      set bytes = greatest(0, storage_usage.bytes + excluded.bytes),
          updated_at = now()
  `);
}

/** Counts `bytes` towards every scope, in the caller's transaction. */
export const addUsage = (
  tx: Executor,
  scopes: UsageScope[],
  bytes: number
): Promise<void> => moveUsage(tx, scopes, Math.max(0, Math.round(bytes)));

/** Takes `bytes` off every scope, in the caller's transaction. */
export const subtractUsage = (
  tx: Executor,
  scopes: UsageScope[],
  bytes: number
): Promise<void> => moveUsage(tx, scopes, -Math.max(0, Math.round(bytes)));

/**
 * Records the bytes a freshly written image variant takes: on the image, so
 * the counters stay derivable from rows, and on the scopes the image belongs
 * to. Keyed by the original's stored key, which is what the resizer knows.
 */
export async function addVariantUsage(
  imageKey: string,
  bytes: number
): Promise<void> {
  if (bytes <= 0) return;

  await db.execute(sql`
    with owner as (
      update images
        set variant_bytes = variant_bytes + ${bytes}
        where image_path = ${imageKey}
        returning project_id, created_by_user
    ), scopes as (
      select 'project'::storage_scope as scope_kind, project_id::text as scope_id
        from owner where project_id is not null
      union all
      select 'user'::storage_scope, created_by_user
        from owner where created_by_user is not null
    )
    insert into storage_usage (scope_kind, scope_id, bytes)
    select scope_kind, scope_id, ${bytes}::bigint from scopes
    on conflict (scope_kind, scope_id) do update
      set bytes = greatest(0, storage_usage.bytes + excluded.bytes),
          updated_at = now()
  `);
}

/** A cap stated in gigabytes, in bytes; null stays unlimited. */
const capBytes = (gigabytes: number | null): number | null =>
  gigabytes == null ? null : Math.floor(gigabytes * 1024 ** 3);

/**
 * The instance's cap on a scope kind, or null where it sets none. Read from
 * the policy on every check, so a changed cap applies to the next upload.
 */
const instanceCapFor = (kind: StorageScopeKind): number | null => {
  const { projectCapGb, userCapGb } = instancePolicy().limits;
  return capBytes(kind === "project" ? projectCapGb : userCapGb);
};

/**
 * The cap on a scope, or null where nothing sets one: the instance's cap for
 * the scope's kind, lowered for a project by the project's own cap where it
 * sets one. A project cap above the instance's changes nothing.
 */
export async function limitFor(scope: UsageScope): Promise<number | null> {
  const instanceCap = instanceCapFor(scope.kind);
  if (scope.kind !== "project") return instanceCap;

  const projectCap = capBytes(
    (await projectPolicy(scope.id)).audio.storageCapGb
  );
  if (projectCap == null) return instanceCap;
  return instanceCap == null ? projectCap : Math.min(instanceCap, projectCap);
}

export async function usageFor(scope: UsageScope): Promise<number> {
  const [row] = await db
    .select({ bytes: storageUsage.bytes })
    .from(storageUsage)
    .where(
      and(
        eq(storageUsage.scopeKind, scope.kind),
        eq(storageUsage.scopeId, String(scope.id))
      )
    );
  return row?.bytes ?? 0;
}

export async function reportFor(scope: UsageScope): Promise<StorageReport> {
  return {
    scopeKind: scope.kind,
    scopeId: String(scope.id),
    usedBytes: await usageFor(scope),
    limitBytes: await limitFor(scope),
  };
}

/**
 * Refuses `bytes` more storage in any scope that would pass its cap. The
 * message names the scope a person can do something about, and the body
 * carries the two numbers so a client can say which limit was hit and how
 * much room is left. `pending` is what the caller has already taken in a scope
 * and not yet counted, which the scope's counter does not show.
 */
export async function assertStorageAllows(
  scopes: UsageScope[],
  bytes: number,
  pending: (scope: UsageScope) => number = () => 0
): Promise<void> {
  for (const scope of scopes) {
    const limit = await limitFor(scope);
    if (limit == null) continue;

    const used = (await usageFor(scope)) + pending(scope);
    if (used + bytes <= limit) continue;

    throw new ApiError(413, {
      code: "storage_limit",
      message:
        scope.kind === "project"
          ? "This project is at its storage limit"
          : "Your account is at its storage limit",
      details: {
        scopeKind: scope.kind,
        usedBytes: used,
        limitBytes: limit,
      },
    });
  }
}

/**
 * How many more bytes every capped scope would take, or null where nothing
 * caps them. What a conversion measures its output against while it runs.
 */
export async function remainingAllowance(
  scopes: UsageScope[]
): Promise<number | null> {
  let remaining: number | null = null;
  for (const scope of scopes) {
    const limit = await limitFor(scope);
    if (limit == null) continue;

    const left = Math.max(0, limit - (await usageFor(scope)));
    remaining = remaining == null ? left : Math.min(remaining, left);
  }
  return remaining;
}

/**
 * An object's payer is the scope of its earliest `repo_objects` row, by
 * `(pushed_at, repo_id)`: the first push of the hash onto the instance. The
 * key is unique, so exactly one row of a hash is its earliest. `ro` is the
 * row under test; the probe reads the `(object_hash, pushed_at, repo_id)`
 * index.
 */
const isEarliestLink = sql`
  not exists (select 1
                from repo_objects earlier
               where earlier.object_hash = ro.object_hash
                 and (earlier.pushed_at, earlier.repo_id) < (ro.pushed_at, ro.repo_id))
`;

/**
 * The bytes of the repo objects a project pays for, as a SQL value for the
 * project whose id `projectId` names: the objects whose earliest link sits in
 * one of its repos. An object any number of repos and projects hold is counted
 * once on the instance.
 */
const projectRepoBytes = (projectId: SQL): SQL => sql`
  coalesce((select sum(o.size)
              from repo_objects ro
              join repos r on r.id = ro.repo_id
              join objects o on o.hash = ro.object_hash
             where r.project_id = ${projectId}
               and ${isEarliestLink}), 0)
`;

/**
 * The bytes of the repo objects a user pays for, as a SQL value for the user
 * whose id `userId` names: the objects whose earliest link they pushed.
 */
const userRepoBytes = (userId: SQL): SQL => sql`
  coalesce((select sum(o.size)
              from repo_objects ro
              join objects o on o.hash = ro.object_hash
             where ro.pushed_by = ${userId}
               and ${isEarliestLink}), 0)
`;

/**
 * What every scope is actually holding, derived from the rows that own the
 * bytes: a project counts its assets, its images and their resizes, the
 * spectrograms its tracks' versions wrote, and the repo objects its repos
 * hold; a user counts everything they uploaded, in any project, plus their
 * avatar and the repo objects they pushed. A file counted by both a project
 * and a user is one file seen twice, which is what the two scopes are for.
 */
const ACTUAL_USAGE = sql`
  select 'project'::storage_scope as scope_kind,
         p.id::text as scope_id,
         coalesce((select sum(a.size) from assets a where a.project_id = p.id), 0)
       + coalesce((select sum(i.size + i.variant_bytes) from images i where i.project_id = p.id), 0)
       + coalesce((select sum(ta.spectrogram_bytes)
                     from track_audios ta
                     join tracks t on t.id = ta.track_id
                    where t.project_id = p.id), 0)
       + ${projectRepoBytes(sql`p.id`)} as bytes
    from projects p
  union all
  select 'user'::storage_scope,
         u.id,
         coalesce((select sum(a.size) from assets a where a.created_by_user = u.id), 0)
       + coalesce((select sum(i.size + i.variant_bytes) from images i where i.created_by_user = u.id), 0)
       + ${userRepoBytes(sql`u.id`)}
    from users u
`;

/** The bytes of the repo objects a project holds, as `ACTUAL_USAGE` counts them. */
export async function repoBytes(projectId: number): Promise<number> {
  const { rows } = await db.execute<{ bytes: string | number }>(
    sql`select ${projectRepoBytes(sql`${projectId}`)} as bytes`
  );
  return Number(rows[0]?.bytes ?? 0);
}

/**
 * The scopes that gain bytes when `pushedBy` links the object `hash` into
 * `repoId`: the repo's project and the pusher, when no repo anywhere holds the
 * object, and nobody otherwise: the first pusher pays, and a later link costs
 * nothing. Call it before the `repo_objects` row is written, in the
 * transaction that writes it, and hand the result to `assertStorageAllows` and
 * then `addUsage`. Two first pushes of one object that race can both count
 * it; the audit corrects the counter.
 */
export async function newRepoObjectScopes(
  tx: Executor,
  repoId: number,
  hash: string,
  pushedBy: string | null
): Promise<UsageScope[]> {
  const { rows } = await tx.execute<{
    project_id: number | null;
    held: boolean;
  }>(sql`
    select (select project_id from repos where id = ${repoId}) as project_id,
           exists (select 1 from repo_objects where object_hash = ${hash}) as held
  `);

  const row = rows[0];
  if (!row || row.held) return [];

  const scopes: UsageScope[] = [];
  if (row.project_id != null) scopes.push(projectScope(row.project_id));
  if (pushedBy != null) scopes.push(userScope(pushedBy));
  return scopes;
}

/** A counter the audit found out of step with the rows it summarises. */
export type UsageDrift = {
  scopeKind: StorageScopeKind;
  scopeId: string;
  recordedBytes: number;
  actualBytes: number;
};

/**
 * Re-derives the counters and reports the ones that had drifted.
 *
 * The old value is read and the new one written in a single statement: the
 * `previous` branch sees the table as it was before the insert, so the drift
 * it reports is what the upsert has just corrected. Without `only`, every
 * scope on the instance is re-derived.
 */
async function syncUsage(only?: UsageScope[]): Promise<UsageDrift[]> {
  if (only?.length === 0) return [];

  const scoped = only
    ? sql`where (actual.scope_kind, actual.scope_id) in (${sql.join(
        only.map(
          (scope) => sql`(${scope.kind}::storage_scope, ${String(scope.id)})`
        ),
        sql`, `
      )})`
    : sql``;

  const { rows } = await db.execute<{
    scope_kind: StorageScopeKind;
    scope_id: string;
    recorded: string | number;
    actual: string | number;
  }>(sql`
    with actual as (${ACTUAL_USAGE}),
    scoped as (select * from actual ${scoped}),
    previous as (select scope_kind, scope_id, bytes from storage_usage),
    written as (
      insert into storage_usage (scope_kind, scope_id, bytes)
      select scope_kind, scope_id, bytes from scoped
      on conflict (scope_kind, scope_id) do update
        set bytes = excluded.bytes, updated_at = now()
      returning 1
    )
    select s.scope_kind, s.scope_id, s.bytes as actual,
           coalesce(p.bytes, 0) as recorded
      from scoped s
      left join previous p
        on p.scope_kind = s.scope_kind and p.scope_id = s.scope_id
     where s.bytes is distinct from coalesce(p.bytes, 0)
  `);

  return rows.map((row) => ({
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    recordedBytes: Number(row.recorded),
    actualBytes: Number(row.actual),
  }));
}

/** Re-derives the named scopes' counters, after a delete cascaded past them. */
export const recomputeUsage = (scopes: UsageScope[]): Promise<UsageDrift[]> =>
  syncUsage(scopes);

/**
 * Re-derives every counter and drops the rows of scopes that no longer exist.
 * The audit's repair pass: a write path that forgot the counter, or a crash
 * between a row and its counter, is corrected here and reported as drift.
 */
export async function recomputeAllUsage(): Promise<UsageDrift[]> {
  const drift = await syncUsage();

  await db.execute(sql`
    delete from storage_usage su
     where not exists (
       select 1 from (${ACTUAL_USAGE}) actual
        where actual.scope_kind = su.scope_kind
          and actual.scope_id = su.scope_id
     )
  `);

  return drift;
}

/**
 * Drops a project's counter and re-derives the counters of everyone who had
 * bytes in it, around the delete that cascades those rows away. The uploaders
 * and the pushers of its repos' objects are read first: once the project is
 * gone, nothing names them any more. So are the successors: the projects and
 * pushers holding other links of an object this project's repos hold, one of
 * which pays for the object once its earliest link is gone.
 */
export async function releasingProjectUsage<T>(
  projectId: number,
  deleteProject: () => Promise<T>
): Promise<T> {
  const { rows } = await db.execute<{
    user_id: string | null;
    project_id: number | null;
  }>(sql`
    select distinct created_by_user as user_id, null::int as project_id from assets
      where project_id = ${projectId} and created_by_user is not null
    union
    select distinct created_by_user, null::int from images
      where project_id = ${projectId} and created_by_user is not null
    union
    select distinct ro.pushed_by, null::int
      from repo_objects ro
      join repos r on r.id = ro.repo_id
     where r.project_id = ${projectId} and ro.pushed_by is not null
    union
    select distinct other.pushed_by, other_repo.project_id
      from repo_objects ro
      join repos r on r.id = ro.repo_id
      join repo_objects other on other.object_hash = ro.object_hash
      join repos other_repo on other_repo.id = other.repo_id
     where r.project_id = ${projectId} and other_repo.project_id <> ${projectId}
  `);

  const result = await deleteProject();

  await db
    .delete(storageUsage)
    .where(
      and(
        eq(storageUsage.scopeKind, "project"),
        eq(storageUsage.scopeId, String(projectId))
      )
    );
  await recomputeUsage(distinctScopes(rows));

  return result;
}

/** The distinct project and user scopes `rows` name. */
function distinctScopes(
  rows: { user_id: string | null; project_id: number | null }[]
): UsageScope[] {
  const scopes = new Map<string, UsageScope>();
  for (const row of rows) {
    if (row.user_id != null) {
      const user = userScope(row.user_id);
      scopes.set(`user:${user.id}`, user);
    }
    if (row.project_id != null) {
      const project = projectScope(row.project_id);
      scopes.set(`project:${project.id}`, project);
    }
  }
  return [...scopes.values()];
}

/**
 * The projects and pushers that hold a link of any of `hashes` right now: the
 * scopes one of whose links now pays for an object whose earlier link was
 * just removed. Hand the result to {@link recomputeUsage}.
 */
export async function holdersOf(hashes: string[]): Promise<UsageScope[]> {
  if (hashes.length === 0) return [];
  const { rows } = await db.execute<{
    user_id: string | null;
    project_id: number;
  }>(sql`
    select distinct ro.pushed_by as user_id, r.project_id
      from repo_objects ro
      join repos r on r.id = ro.repo_id
     where ro.object_hash in (${sql.join(
       hashes.map((hash) => sql`${hash}`),
       sql`, `
     )})
  `);
  return distinctScopes(rows);
}

/** What a repo holds, as the repo shape's `storage` reports it. */
export type RepoStorage = {
  setBytes: number;
  sampleBytes: number;
  sharedBytes: number;
};

/** A repo that holds nothing. */
export const emptyRepoStorage = (): RepoStorage => ({
  setBytes: 0,
  sampleBytes: 0,
  sharedBytes: 0,
});

/**
 * What each repo of `repoIds` holds, whoever pays: `sampleBytes` is the
 * objects `save_sample_objects` lists for saves of the repo's sessions (a
 * Chunked sample's chunks included), `setBytes` every other object its links
 * name, `sharedBytes` the part of `sampleBytes` whose earliest link by
 * `(pushed_at, repo_id)` is another repo's: what sharing saves this repo. A
 * repo with no object is 0 throughout.
 */
export async function repoStorages(
  repoIds: readonly number[]
): Promise<Map<number, RepoStorage>> {
  const storages = new Map<number, RepoStorage>(
    repoIds.map((id) => [id, emptyRepoStorage()])
  );
  if (repoIds.length === 0) return storages;

  const { rows } = await db.execute<{
    repo_id: number;
    set_bytes: string | number;
    sample_bytes: string | number;
    shared_bytes: string | number;
  }>(sql`
    with samples as (
      select distinct se.repo_id, sso.object_hash as hash
        from save_sample_objects sso
        join saves s on s.id = sso.save_id
        join sessions se on se.id = s.session_id
       where se.repo_id in (${sql.join(
         repoIds.map((id) => sql`${id}`),
         sql`, `
       )})
    )
    select ro.repo_id,
           coalesce(sum(o.size) filter (where sm.hash is null), 0) as set_bytes,
           coalesce(sum(o.size) filter (where sm.hash is not null), 0) as sample_bytes,
           coalesce(sum(o.size) filter (
             where sm.hash is not null
               and not ${isEarliestLink}
           ), 0) as shared_bytes
      from repo_objects ro
      join objects o on o.hash = ro.object_hash
      left join samples sm on sm.repo_id = ro.repo_id and sm.hash = ro.object_hash
     where ro.repo_id in (${sql.join(
       repoIds.map((id) => sql`${id}`),
       sql`, `
     )})
     group by ro.repo_id
  `);
  for (const row of rows) {
    const storage = storages.get(row.repo_id);
    if (!storage) continue;
    storage.setBytes = Number(row.set_bytes);
    storage.sampleBytes = Number(row.sample_bytes);
    storage.sharedBytes = Number(row.shared_bytes);
  }
  return storages;
}

/**
 * Every counter, biggest first, with the name of the project or account it
 * belongs to. A row whose scope has been deleted but not yet audited away has
 * no name.
 */
export async function allUsageReports(
  executor: Executor = db
): Promise<StorageReport[]> {
  const { rows } = await executor.execute<{
    scope_kind: StorageScopeKind;
    scope_id: string;
    bytes: string | number;
    name: string | null;
  }>(sql`
    select su.scope_kind, su.scope_id, su.bytes, coalesce(p.name, u.name) as name
      from storage_usage su
      left join projects p on su.scope_kind = 'project' and p.id::text = su.scope_id
      left join users u on su.scope_kind = 'user' and u.id = su.scope_id
     order by su.bytes desc
  `);

  return Promise.all(
    rows.map(async (row) => ({
      scopeKind: row.scope_kind,
      scopeId: row.scope_id,
      name: row.name,
      usedBytes: Number(row.bytes),
      limitBytes: await limitFor(
        row.scope_kind === "project"
          ? projectScope(Number(row.scope_id))
          : userScope(row.scope_id)
      ),
    }))
  );
}

/**
 * What the instance is holding: every project's counter plus the avatars, which
 * belong to their uploaders rather than to any project. Summing the user
 * counters instead would double-count every file that lives in a project.
 */
export async function instanceUsedBytes(
  executor: Executor = db
): Promise<number> {
  const { rows } = await executor.execute<{ bytes: string | number }>(sql`
    select coalesce((select sum(bytes) from storage_usage where scope_kind = 'project'), 0)
         + coalesce((select sum(size + variant_bytes) from images where project_id is null), 0)
        as bytes
  `);
  return Number(rows[0]?.bytes ?? 0);
}

/** What each project pays for of the repo objects, by project id; projects paying nothing are absent. */
export async function repositoryBytesByProject(): Promise<Map<number, number>> {
  const { rows } = await db.execute<{
    project_id: number;
    bytes: string | number;
  }>(sql`
    select r.project_id, sum(o.size) as bytes
      from repo_objects ro
      join repos r on r.id = ro.repo_id
      join objects o on o.hash = ro.object_hash
     where ${isEarliestLink}
     group by r.project_id
  `);
  return new Map(rows.map((row) => [row.project_id, Number(row.bytes)]));
}

/**
 * What storing samples once saves: `projects` is how many projects hold at
 * least one sample object another project also holds, `savedBytes` what the
 * second and later holders would each have paid for. Only objects some
 * commit's save lists as a sample count.
 */
export async function sharedRepoStorage(): Promise<{
  projects: number;
  savedBytes: number;
}> {
  const { rows } = await db.execute<{
    projects: string | number;
    saved: string | number;
  }>(sql`
    with held as (
      select ro.object_hash, r.project_id
        from repo_objects ro
        join repos r on r.id = ro.repo_id
       where exists (select 1 from save_sample_objects sso
                      where sso.object_hash = ro.object_hash)
       group by ro.object_hash, r.project_id
    ),
    shared as (
      select object_hash, count(*) as holders
        from held
       group by object_hash
      having count(*) > 1
    )
    select (select count(distinct h.project_id)
              from held h
              join shared s on s.object_hash = h.object_hash) as projects,
           coalesce((select sum(o.size * (s.holders - 1))
                       from shared s
                       join objects o on o.hash = s.object_hash), 0) as saved
  `);
  return {
    projects: Number(rows[0]?.projects ?? 0),
    savedBytes: Number(rows[0]?.saved ?? 0),
  };
}
