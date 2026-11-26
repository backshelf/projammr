import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { authSessions } from "../schema/auth.js";

/** The pool, or a transaction on it. */
type Executor = Pick<typeof db, "delete">;

/**
 * Deletes every session an account holds, signing it out everywhere. Better
 * Auth's cookie cache means a session it has already minted a cached copy of
 * keeps resolving until that copy expires (`session.cookieCache.maxAge`), so
 * this is what ends the session everywhere the cache is not in play — and what
 * makes the next cache miss land on nothing.
 */
export async function revokeUserSessions(
  userId: string,
  executor: Executor = db
): Promise<number> {
  const removed = await executor
    .delete(authSessions)
    .where(eq(authSessions.userId, userId))
    .returning({ id: authSessions.id });
  return removed.length;
}
