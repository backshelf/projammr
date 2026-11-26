import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-account brute-force tracking for `POST /auth/sign-in/email`. Keyed by
 * `sha256(lowercased email)` (`emailHashOf`, `db/queries/signin-attempts.ts`)
 * rather than the address itself, so the table names no accounts that don't
 * exist and a leaked row carries nothing readable back to a real email. A row
 * is deleted outright on the next successful sign-in or an admin-issued reset
 * link, so an account in good standing has none.
 */
export const signinAttempts = pgTable("signin_attempts", {
  emailHash: text("email_hash").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStartedAt: timestamp("window_started_at").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until"),
});
