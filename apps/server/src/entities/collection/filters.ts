import { z } from "zod";
import { idListParamSchema } from "../filters.js";

/**
 * The column filters a collection listing reads, on top of the shared
 * pagination params. The paginated route's query schema is built from these,
 * and `scripts/generate-api.ts` emits their names into the API package as
 * `COLLECTION_FILTER_PARAMS`, the client's filter vocabulary. Kept free of the
 * query layer so that package's drift guard can import it.
 */
export const collectionFilterSchema = z.object({
  status: z.coerce.number().int().optional(),
  priority: idListParamSchema,
});
