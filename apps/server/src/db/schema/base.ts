import { integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";

/** When a row was written and last touched. Every domain table carries both. */
export const baseTimestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const baseSchema = {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ...baseTimestamps,
};

/**
 * The timestamps the database owns, dropped from every insert and update
 * schema. `id` needs no entry: it is `generatedAlwaysAsIdentity`, which
 * drizzle-zod already leaves out of both.
 */
export const baseSchemaIgnores = {
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The project a row belongs to, dropped from every update schema. Scope is
 * fixed at creation: a request is authorized against the project the row is
 * already in, so letting the body name a different one — or none — would move
 * the row past a gate that never checked the destination.
 */
export const scopeIgnores = { projectId: true } as const;

/**
 * The cover path only `/images/parent/*` and MCP's cover tools may write:
 * an entity's `image` must always name a stored `images` row so artwork
 * resolution, palette extraction, variants and storage accounting stay intact.
 */
export const imageIgnores = { image: true } as const;

/**
 * A BlockNote document: an array of blocks whose inner shape the editor owns.
 * Stored as jsonb and handed back to the editor untouched.
 */
export type BlockDocument = Record<string, unknown>[];

export const blockDocumentSchema = z.array(z.record(z.string(), z.unknown()));

/** A colour a project vocabulary paints with: `#rrggbb`, or `#rrggbbaa`. */
export const colourHexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

/**
 * A pg `date` column round-trips as a bare `YYYY-MM-DD` string (mode
 * "string", drizzle-zod's default): the regex pins the shape, the refine
 * rejects a shape-valid date that isn't a real one (`2026-02-30`). Output
 * stays a string — no `z.date()` transform — so the wire contract and the
 * generated OpenAPI types don't change.
 */
export const releaseDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "must be a real calendar date");
