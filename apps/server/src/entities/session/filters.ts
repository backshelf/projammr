import { z } from "zod";
import { dawIdSchema } from "../../db/schema/sessions.js";
import { idListParamSchema } from "../filters.js";

/**
 * The column filters a session listing reads, on top of the shared pagination
 * params and the `archived` scope. The paginated route's query schema is built
 * from these, and `scripts/generate-api.ts` emits their names into the API
 * package as `SESSION_FILTER_PARAMS`, the client's filter vocabulary. Kept free
 * of the query layer so that package's drift guard can import it.
 */
export const sessionFilterSchema = z.object({
  daw: dawIdSchema.optional(),
  priority: idListParamSchema,
  track: z.coerce.number().int().optional(),
  inDit: z.stringbool().optional(),
});
