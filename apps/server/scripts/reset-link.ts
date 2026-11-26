/**
 * Prints a one-time password reset link for an account, the same thing
 * `POST /admin/users/:id/reset-link` returns — for the operator locked out of
 * the admin surface itself: `docker compose exec api bun dist/scripts/reset-link.js <email>`.
 * Valid for one hour; clears the address's sign-in lockout the same way the
 * admin route does.
 */
import { findAccountIdByEmail } from "../src/db/queries/instance-users.js";
import { mintResetLink } from "../src/db/queries/reset-link.js";
import { clearLockout } from "../src/db/queries/signin-attempts.js";
import { db } from "../src/db/index.js";
import { log } from "../src/lib/log.js";

const logger = log("reset-link");

const email = process.argv[2];
if (!email) {
  logger.error("usage: reset-link.ts <email>");
  process.exit(1);
}

try {
  const userId = await findAccountIdByEmail(email);
  if (!userId) {
    logger.error("no account holds that email", { email });
    process.exit(1);
  }

  const url = await mintResetLink(userId);
  await clearLockout(email);
  logger.info("reset link", { email, url });
  console.log(url);
} finally {
  await db.$client.end();
}
