import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../index.js";
import { branches } from "../schema/repos.js";

/** A dit branch's name as a push states it. */
export const branchNameSchema = z.string().trim().min(1).max(200);

/** The branch of the session called `name`, made if this is its first mention. */
export async function branchIdOf(
  tx: Tx,
  sessionId: number,
  name: string
): Promise<number> {
  const [created] = await tx
    .insert(branches)
    .values({ sessionId, name })
    .onConflictDoNothing()
    .returning({ id: branches.id });
  if (created) return created.id;

  const [existing] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.sessionId, sessionId), eq(branches.name, name)));
  return existing!.id;
}
