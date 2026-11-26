import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { signinAttempts } from "../schema/signin-attempts.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import {
  checkLockout,
  clearLockout,
  emailHashOf,
  lockAfter,
  recordFailure,
} from "./signin-attempts.js";

const testEmail = () => `lockout-${crypto.randomUUID()}@example.com`;

afterEach(() => {
  mock.restore();
  restoreInstancePolicy();
});

describe("lockAfter", () => {
  it("gives five failures for free", () => {
    for (let failures = 1; failures <= 5; failures += 1) {
      expect(lockAfter(failures, 0)).toBeNull();
    }
  });

  it("doubles the lock every failure past the free allowance, capped at an hour", () => {
    const now = 1_700_000_000_000;
    expect(lockAfter(6, now)).toBe(now + 60_000);
    expect(lockAfter(7, now)).toBe(now + 120_000);
    expect(lockAfter(8, now)).toBe(now + 240_000);
    expect(lockAfter(20, now)).toBe(now + 60 * 60_000);
  });

  it("follows the instance's lockout rule in force", () => {
    stubInstancePolicy({
      access: {
        lockoutFreeFailures: 2,
        lockoutBaseMinutes: 5,
        lockoutMaxMinutes: 12,
      },
    });
    const now = 1_700_000_000_000;

    expect(lockAfter(2, now)).toBeNull();
    expect(lockAfter(3, now)).toBe(now + 5 * 60_000);
    expect(lockAfter(4, now)).toBe(now + 10 * 60_000);
    expect(lockAfter(5, now)).toBe(now + 12 * 60_000);
  });
});

describe("recordFailure / checkLockout / clearLockout", () => {
  it("stays unlocked for the first five failures, then locks on the sixth", async () => {
    const email = testEmail();
    spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    for (let i = 0; i < 5; i += 1) {
      expect(await recordFailure(email)).toBeNull();
      expect((await checkLockout(email)).locked).toBe(false);
    }

    const lockedUntil = await recordFailure(email);
    expect(lockedUntil).toEqual(new Date(1_700_000_000_000 + 60_000));
    expect(await checkLockout(email)).toEqual({
      locked: true,
      retryAfterSeconds: 60,
    });
  });

  it("locks after the instance's own free allowance, for its own base lock", async () => {
    stubInstancePolicy({
      access: { lockoutFreeFailures: 1, lockoutBaseMinutes: 3 },
    });
    const email = testEmail();
    spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    expect(await recordFailure(email)).toBeNull();
    expect(await recordFailure(email)).toEqual(
      new Date(1_700_000_000_000 + 3 * 60_000)
    );
    expect(await checkLockout(email)).toEqual({
      locked: true,
      retryAfterSeconds: 180,
    });
  });

  it("starts a fresh window once 15 minutes have elapsed since the first failure", async () => {
    const email = testEmail();
    const now = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    for (let i = 0; i < 6; i += 1) await recordFailure(email);
    expect((await checkLockout(email)).locked).toBe(true);

    now.mockReturnValue(1_700_000_000_000 + 16 * 60_000);
    // The window has lapsed: this failure is the account's first again, not
    // its seventh, so it carries no lock of its own.
    expect(await recordFailure(email)).toBeNull();
    expect((await checkLockout(email)).locked).toBe(false);
  });

  it("clears the row on success, leaving nothing behind", async () => {
    const email = testEmail();
    spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await recordFailure(email);
    await recordFailure(email);

    await clearLockout(email);

    const [row] = await db
      .select()
      .from(signinAttempts)
      .where(eq(signinAttempts.emailHash, emailHashOf(email)));
    expect(row).toBeUndefined();
    expect((await checkLockout(email)).locked).toBe(false);
  });

  it("locks an email with no account behind it exactly like one that has one", async () => {
    const email = testEmail();
    spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    for (let i = 0; i < 6; i += 1) await recordFailure(email);
    expect(await checkLockout(email)).toEqual({
      locked: true,
      retryAfterSeconds: 60,
    });
  });
});
