import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "../index.js";
import { repoMachines } from "../schema/repos.js";
import { sessions } from "../schema/sessions.js";
import { isUniqueViolation } from "../unique-violation.js";

/** Records or refreshes where `repoId` lives on disk on `machineId`. */
export async function upsertRepoMachinePath(
  executor: Tx | typeof db,
  repoId: number,
  machineId: string,
  localPath: string
): Promise<void> {
  const trimmed = localPath.trim();
  if (!trimmed) return;
  await executor
    .insert(repoMachines)
    .values({ repoId, machineId, localPath: trimmed })
    .onConflictDoUpdate({
      target: [repoMachines.repoId, repoMachines.machineId],
      set: { localPath: trimmed, updatedAt: new Date() },
    });
}

/**
 * Records a session's local file path and machine name without violating the
 * project-scoped `dedupe_filepaths` unique index when another session in the
 * project already holds that path.
 */
export async function setSessionLocalFilepath(
  executor: Tx | typeof db,
  sessionId: number,
  projectId: number,
  localFilepath: string,
  machineName: string | null
): Promise<void> {
  const trimmed = localFilepath.trim();
  if (!trimmed) return;
  try {
    await executor
      .update(sessions)
      .set({
        localFilepath: trimmed,
        ...(machineName ? { localFileMachineName: machineName } : {}),
      })
      .where(
        and(
          eq(sessions.id, sessionId),
          sql`not exists (select 1 from ${sessions} s2 where s2.project_id = ${projectId} and s2.local_filepath = ${trimmed} and s2.id <> ${sessionId})`
        )
      );
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
}
