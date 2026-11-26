import { and, eq, gt, notExists } from "drizzle-orm";
import { db } from "../index.js";
import { instancePolicy } from "../../lib/instance-policy.js";
import { errorFields, log } from "../../lib/log.js";
import { startPolicyTimer } from "../../lib/policy-timer.js";
import { authSessions, users } from "../schema/auth.js";
import { comments } from "../schema/comments.js";

const logger = log("guests");

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often the reaper runs — once a day is often enough for an allowance
 *  measured in days. */
const REAP_INTERVAL_MS = DAY_MS;

/**
 * Moves a linking guest's comments onto the account they just registered, so
 * commenting anonymously and then signing up keeps the name on what was
 * already said instead of orphaning it. Called from `auth.ts`'s
 * `onLinkAccount` before the anonymous plugin deletes the guest's own row —
 * `comments.userId` cascades on delete, so this has to land first.
 */
export async function reassignGuestComments(
  anonymousUserId: string,
  newUserId: string
): Promise<void> {
  await db
    .update(comments)
    .set({ userId: newUserId })
    .where(eq(comments.userId, anonymousUserId));
}

/**
 * Deletes every anonymous user who left no comment and whose most recent
 * session is older than `olderThanMs`, by default the instance's
 * `limits.guestRetentionDays` (a month unless it says otherwise: long enough
 * that a reader who comes back to a link keeps their name on what they
 * already said). A guest who commented is kept regardless of how stale their
 * session gets, since a comment still names them; one who never did and
 * hasn't been seen in the window is nothing but a session row nobody will
 * read again. Session rows cascade with the user.
 */
export async function reapAnonymousUsers(
  olderThanMs = instancePolicy().limits.guestRetentionDays * DAY_MS
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);

  const deleted = await db
    .delete(users)
    .where(
      and(
        eq(users.isAnonymous, true),
        notExists(
          db.select().from(comments).where(eq(comments.userId, users.id))
        ),
        notExists(
          db
            .select()
            .from(authSessions)
            .where(
              and(
                eq(authSessions.userId, users.id),
                gt(authSessions.updatedAt, cutoff)
              )
            )
        )
      )
    )
    .returning({ id: users.id });

  return deleted.length;
}

/**
 * Runs the reaper once at boot, then once a day and again at once when the
 * instance changes its guest retention, unref'd so it cannot hold the process
 * open on its own. Only `server.ts` calls it: `app.ts` is imported by every
 * test file and by `generate-api.ts`, neither of which wants a background
 * interval running against a database that may not exist.
 */
export function startGuestReaper(): void {
  const run = () => {
    reapAnonymousUsers()
      .then((count) => {
        if (count > 0) logger.info("reaped anonymous users", { count });
      })
      .catch((error) => {
        logger.error("anonymous-user reaper failed", errorFields(error));
      });
  };

  run();
  startPolicyTimer(run, {
    intervalMs: () => REAP_INTERVAL_MS,
    runAgainOn: (policy) => policy.limits.guestRetentionDays,
  });
}
