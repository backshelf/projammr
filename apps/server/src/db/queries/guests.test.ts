import { eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { setupSuite, signUpAndSignIn } from "../../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { db } from "../index.js";
import { authSessions, users } from "../schema/auth.js";
import { comments } from "../schema/comments.js";
import { reapAnonymousUsers, reassignGuestComments } from "./guests.js";

const suite = setupSuite("Guest reaper");
const { requireProject, mkTrack } = suite;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let counter = 0;

/** A bare anonymous-plugin-shaped row, written directly rather than through
 *  sign-in: the reaper reads `isAnonymous` and timestamps, and never a real
 *  session token. */
async function mkAnonymousUser(name: string): Promise<string> {
  counter++;
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({
      id: `guest-reaper-${suffix}`,
      name,
      email: `guest-reaper-${suffix}@anonymous.placeholder.invalid`,
      isAnonymous: true,
    })
    .returning({ id: users.id });
  return user!.id;
}

async function mkSession(userId: string, updatedAt: Date): Promise<void> {
  await db.insert(authSessions).values({
    id: `guest-reaper-session-${userId}`,
    token: `guest-reaper-token-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt,
  });
}

async function userExists(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  return row != null;
}

describe("reapAnonymousUsers", () => {
  it("deletes a stale, commentless guest but keeps one who commented or was seen recently", async () => {
    requireProject();
    const trackId = await mkTrack("Reaper track");

    const stale = await mkAnonymousUser("Stale guest");
    await mkSession(stale, new Date(Date.now() - THIRTY_DAYS_MS - 60_000));

    const recent = await mkAnonymousUser("Recent guest");
    await mkSession(recent, new Date());

    const commenter = await mkAnonymousUser("Commenting guest");
    await mkSession(commenter, new Date(Date.now() - THIRTY_DAYS_MS - 60_000));
    const [comment] = await db
      .insert(comments)
      .values({
        targetType: "track",
        targetId: trackId,
        projectId: suite.projectId,
        userId: commenter,
        content: "Still here",
      })
      .returning({ id: comments.id });

    try {
      await reapAnonymousUsers();

      expect(await userExists(stale)).toBe(false);
      expect(await userExists(recent)).toBe(true);
      expect(await userExists(commenter)).toBe(true);
    } finally {
      await db.delete(comments).where(eq(comments.id, comment!.id));
      await db.delete(users).where(eq(users.id, recent));
      await db.delete(users).where(eq(users.id, commenter));
    }
  });

  it("reaps to the retention the instance sets", async () => {
    const day = 24 * 60 * 60 * 1000;
    const threeDaysIdle = await mkAnonymousUser("Three days idle");
    await mkSession(threeDaysIdle, new Date(Date.now() - 3 * day));
    const oneDayIdle = await mkAnonymousUser("One day idle");
    await mkSession(oneDayIdle, new Date(Date.now() - day));

    stubInstancePolicy({ limits: { guestRetentionDays: 2 } });
    try {
      await reapAnonymousUsers();

      expect(await userExists(threeDaysIdle)).toBe(false);
      expect(await userExists(oneDayIdle)).toBe(true);
    } finally {
      restoreInstancePolicy();
      await db.delete(users).where(eq(users.id, oneDayIdle));
    }
  });
});

describe("reassignGuestComments", () => {
  it("moves a guest's comments onto the account they registered as", async () => {
    requireProject();
    const trackId = await mkTrack("Reassign track");
    const guest = await mkAnonymousUser("Linking guest");
    await mkSession(guest, new Date());
    const [comment] = await db
      .insert(comments)
      .values({
        targetType: "track",
        targetId: trackId,
        projectId: suite.projectId,
        userId: guest,
        content: "Before linking",
      })
      .returning({ id: comments.id });
    const registered = await signUpAndSignIn("Reassign target");

    try {
      await reassignGuestComments(guest, registered.userId);

      const [row] = await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(eq(comments.id, comment!.id));
      expect(row!.userId).toBe(registered.userId);
    } finally {
      await db.delete(comments).where(eq(comments.id, comment!.id));
      await db.delete(users).where(eq(users.id, guest));
      await db.delete(users).where(eq(users.id, registered.userId));
    }
  });
});
