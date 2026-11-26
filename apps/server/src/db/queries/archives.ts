import { and, asc, eq } from "drizzle-orm";
import { db } from "../index.js";
import { branches, commits, repos } from "../schema/repos.js";
import type { SampleRef } from "../schema/samples.js";
import { saves } from "../schema/saves.js";
import { sessions } from "../schema/sessions.js";

/** The references of a save and nothing else; a save with none reports none. */
export async function saveSampleRefs(saveId: number): Promise<SampleRef[]> {
  const [row] = await db
    .select({ meta: saves.meta })
    .from(saves)
    .where(eq(saves.id, saveId));
  return row?.meta?.samples ?? [];
}

/** A repo's name, or undefined when there is no such repo. */
export async function repoName(repoId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: repos.name })
    .from(repos)
    .where(eq(repos.id, repoId));
  return row?.name;
}

/**
 * Each set of the repo at the tip of its `main` branch: the session the set is
 * named after and the tip commit's own save with its content state. A set
 * with no `main` branch, or none with a commit yet, is not in the answer.
 */
export function mainTips(repoId: number) {
  return db
    .select({
      sessionId: sessions.id,
      sessionName: sessions.name,
      saveId: saves.id,
      contentState: saves.contentState,
      committedAt: commits.committedAt,
    })
    .from(sessions)
    .innerJoin(
      branches,
      and(eq(branches.sessionId, sessions.id), eq(branches.name, "main"))
    )
    .innerJoin(commits, eq(commits.id, branches.headCommitId))
    .innerJoin(saves, eq(saves.id, commits.saveId))
    .where(eq(sessions.repoId, repoId))
    .orderBy(asc(sessions.id));
}
