import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { baseSchemaIgnores } from "./base.js";
import { sampleRefSchema } from "./samples.js";
import { saves } from "./saves.js";
import {
  rootNoteWireSchema,
  scaleWireSchema,
  sessionSchema,
} from "./sessions.js";

/**
 * The wire shapes of a save. They read `sessionSchema` while the module
 * loads, so they sit apart from the `saves` table: the table sits in an import
 * cycle with `sessions` that only lazy column references survive.
 */

/**
 * `meta` is a jsonb column, which a generated select schema types as arbitrary
 * JSON. Restating it as the session fields it is built from is what lets a
 * client diff two saves without casting.
 */
export const saveMetaSchema = sessionSchema
  .pick({
    tempo: true,
    timeSignature: true,
    rootNote: true,
    scale: true,
    tracksCount: true,
    scenesCount: true,
    dawVersion: true,
    structure: true,
  })
  .extend({
    samplePaths: z.array(z.string()).nullable(),
    /** The references dit recorded with the save; absent on a save it did not send them for. */
    samples: z.array(sampleRefSchema).optional(),
  });

export const saveSchema = createSelectSchema(saves).extend({
  meta: saveMetaSchema.nullable(),
});

/**
 * A write takes the same nine fields a read returns, each present (null when
 * the DAW gave none), so a stored `meta` always satisfies
 * {@link saveMetaSchema}. `rootNote` and `scale` go through the session
 * path's wire normalisation; the wire schemas are optional, and unwrapping
 * that leaves the key required and nullable.
 */
export const newSessionRevisionSchema = createInsertSchema(saves)
  .omit(baseSchemaIgnores)
  .extend({
    meta: saveMetaSchema
      .extend({
        rootNote: rootNoteWireSchema.unwrap(),
        scale: scaleWireSchema.unwrap(),
      })
      .nullish(),
  });
