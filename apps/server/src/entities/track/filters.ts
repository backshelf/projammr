import { z } from "zod";
import { idListParamSchema } from "../filters.js";

/** A relation filter names one relation type by id, or `any` for all of them. */
export type RelationFilter = "any" | number;

/**
 * The `relation` param: `any`, or one relation type's id. Any other value (a
 * saved view's name for a kind of relation, say) is no filter, as an unknown
 * value is on a bulk selection.
 */
export const relationFilterSchema = z
  .string()
  .optional()
  .transform((raw): RelationFilter | undefined => {
    if (raw === "any") return "any";
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  });

/**
 * The column filters a track listing reads, on top of the shared pagination
 * params and the `archived` scope. The paginated route's query schema is built
 * from these, and `scripts/generate-api.ts` emits their names into the API
 * package as `TRACK_FILTER_PARAMS`, the client's filter vocabulary. Kept free
 * of the query layer so that package's drift guard can import it.
 */
export const trackFilterSchema = z.object({
  status: z.coerce.number().int().optional(),
  priority: idListParamSchema,
  collection: z.coerce.number().int().optional(),
  relation: relationFilterSchema,
  label: z.coerce.number().int().optional(),
  artist: z.string().optional(),
  explicit: z.stringbool().optional(),
});
