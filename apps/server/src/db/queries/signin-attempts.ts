import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { instancePolicy } from "../../lib/instance-policy.js";
import { db } from "../index.js";
import { signinAttempts } from "../schema/signin-attempts.js";

const WINDOW_MS = 15 * 60_000;
const MINUTE_MS = 60_000;

/**
 * Failures inside the window beyond the instance's free allowance double the
 * lock from its base up to its maximum — 1, 2, 4 … 60 minutes at the defaults.
 * Read from the policy per failure, so a changed rule applies to the next one.
 */
export function lockAfter(failures: number, now: number): number | null {
  const { lockoutFreeFailures, lockoutBaseMinutes, lockoutMaxMinutes } =
    instancePolicy().access;
  if (failures <= lockoutFreeFailures) return null;
  return (
    now +
    Math.min(
      lockoutMaxMinutes * MINUTE_MS,
      lockoutBaseMinutes * MINUTE_MS * 2 ** (failures - lockoutFreeFailures - 1)
    )
  );
}

/**
 * `sha256(lowercased email)` — the table's key, so a row never spells out an
 * address in the clear and one for an account that doesn't exist looks no
 * different from one that does.
 */
export function emailHashOf(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export type LockoutStatus =
  { locked: true; retryAfterSeconds: number } | { locked: false };

/** Whether `email` is currently locked, read before the password check ever runs. */
export async function checkLockout(email: string): Promise<LockoutStatus> {
  const [row] = await db
    .select({ lockedUntil: signinAttempts.lockedUntil })
    .from(signinAttempts)
    .where(eq(signinAttempts.emailHash, emailHashOf(email)))
    .limit(1);
  if (!row?.lockedUntil) return { locked: false };
  const remainingMs = row.lockedUntil.getTime() - Date.now();
  if (remainingMs <= 0) return { locked: false };
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

/**
 * Records one failed sign-in for `email` and returns the lock it produced, if
 * any. Failures outside the account's current 15-minute window don't carry
 * over: a window that has elapsed since its first failure starts fresh at one,
 * the way a account that stopped being attacked is never punished by attempts
 * from long before. Locked in a transaction with `FOR UPDATE` so two failures
 * racing the same account can't both read the same starting count and both
 * miss the lock they should have produced together.
 */
export async function recordFailure(email: string): Promise<Date | null> {
  const emailHash = emailHashOf(email);
  const now = Date.now();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(signinAttempts)
      .where(eq(signinAttempts.emailHash, emailHash))
      .for("update");

    const windowExpired =
      !row || now - row.windowStartedAt.getTime() > WINDOW_MS;
    const failures = windowExpired ? 1 : row.failures + 1;
    const windowStartedAt = windowExpired ? new Date(now) : row.windowStartedAt;
    const lockMs = lockAfter(failures, now);
    const lockedUntil = lockMs == null ? null : new Date(lockMs);

    await tx
      .insert(signinAttempts)
      .values({ emailHash, failures, windowStartedAt, lockedUntil })
      .onConflictDoUpdate({
        target: signinAttempts.emailHash,
        set: { failures, windowStartedAt, lockedUntil },
      });

    return lockedUntil;
  });
}

/**
 * Clears `email`'s lockout row outright. Called on every successful sign-in,
 * and exported for the admin-issued reset link to call directly.
 */
export async function clearLockout(email: string): Promise<void> {
  await db
    .delete(signinAttempts)
    .where(eq(signinAttempts.emailHash, emailHashOf(email)));
}
