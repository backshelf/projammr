import { z } from "zod";

/**
 * Parsers the listings' column filters share. Kept free of the query layer,
 * as the `entities/<kind>/filters.ts` schemas built from them are.
 */

/**
 * A list param naming one or more ids, comma-separated (`priority=3,7`).
 * Absent or blank is no filter.
 */
export const idListParamSchema = z
  .string()
  .optional()
  .transform((raw) =>
    raw
      ?.split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map(Number)
  )
  .pipe(z.array(z.number().int().positive()).optional());
