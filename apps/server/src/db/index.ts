import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "./relations.js";

/**
 * The pool is configured rather than left on `pg`'s defaults: without a
 * `statement_timeout` a single pathological query holds its connection for as
 * long as the database will run it, and with the default `max` of 10 the API
 * saturates well before the database does.
 *
 * Every connection plans each foreign-key check for the table as it stands.
 * Postgres caches a check's plan per connection, and one cached while the
 * referenced table was a page or two is a sequential scan it keeps running
 * after a push has grown the table by thousands of rows, until autovacuum
 * next analyses it: linking a commit's 33,000 objects then scans `objects`
 * once per link. A fresh plan costs microseconds a check.
 */
export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    options: "-c plan_cache_mode=force_custom_plan",
  },
  relations,
});

/** The client a `db.transaction` callback receives. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
