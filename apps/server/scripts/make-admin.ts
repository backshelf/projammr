/**
 * Promotes an existing account to instance admin, for an instance whose only
 * admin is gone (left, disabled themselves, or lost their credentials with
 * mail off): `docker compose exec api bun dist/scripts/make-admin.js <email>`.
 * The account must already exist — this does not create one.
 */
import { db } from "../src/db/index.js";
import {
  changeInstanceUser,
  findAccountIdByEmail,
} from "../src/db/queries/instance-users.js";
import { log } from "../src/lib/log.js";

const logger = log("make-admin");

const email = process.argv[2];
if (!email) {
  logger.error("usage: make-admin.ts <email>");
  process.exit(1);
}

try {
  const userId = await findAccountIdByEmail(email);
  if (!userId) {
    logger.error("no account holds that email", { email });
    process.exit(1);
  }

  // A disabled account cannot sign in, which would leave the instance no
  // better off; the un-disable goes through the same patch as the promotion
  // rather than a direct update, so both changes are audited — a direct write
  // to `disabledAt` is invisible to `changeInstanceUser`, which would record
  // the promotion and silently lose the enable.
  // No signed-in admin runs this script — an operator does, from a shell with
  // no account of their own to name — so the promoted account is recorded as
  // its own actor, the same as account_self_deleted names a self-service
  // account deletion.
  await changeInstanceUser(
    userId,
    { instanceRole: "admin", disabled: false },
    userId
  );
  logger.info("promoted to admin", { email });
} finally {
  await db.$client.end();
}
