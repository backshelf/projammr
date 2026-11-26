import { randomBytes } from "node:crypto";
import { db } from "../index.js";
import { verifications } from "../schema/auth.js";
import { betterAuthUrl } from "../../lib/env.js";
import { instancePolicy } from "../../lib/instance-policy.js";

/**
 * Mints a password-reset verification of the same shape Better Auth's own
 * `sendResetPassword` flow writes when it mails a link
 * (`reset-password:<token>` -> the user id, for the instance's link lifetime,
 * the same as a mailed one), and returns the URL to
 * hand the account holder directly instead of mailing it: the admin reset-link
 * route and `scripts/reset-link.ts` both call this rather than each minting
 * its own token.
 *
 * `POST /api/auth/reset-password` consumes the row on first use
 * (`internalAdapter.consumeVerificationValue` deletes what it reads), so a
 * second attempt with the same token finds nothing and fails the same way an
 * expired one would.
 */
export async function mintResetLink(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(
      Date.now() + instancePolicy().access.linkLifetimeMinutes * 60_000
    ),
  });
  return new URL(`/reset-password?token=${token}`, betterAuthUrl).href;
}
