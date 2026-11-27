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

/**
 * Boolean filter param that accepts both URL query strings (`"true"` / `"false"`)
 * and native JSON booleans (MCP tool arguments).
 */
const boolFilterParam = z.union([z.boolean(), z.stringbool()]).optional();

/**
 * Catalogue audit filters for track listings. Kept separate from
 * {@link trackFilterSchema} so the web table's `TRACK_FILTER_PARAMS` /
 * `FILTER_VALUE_PARSERS` contract stays focused on table columns while REST
 * (`GET /projects/:id/tracks/paginated`), MCP (`list_tracks`), and bulk
 * selections all share these predicates.
 */
export const trackAuditFilterSchema = z.object({
  unlabeled: boolFilterParam.describe(
    "When true, tracks with zero labels; when false, tracks with at least one label."
  ),
  uncollected: boolFilterParam.describe(
    "When true, tracks in no collection; when false, tracks in at least one collection."
  ),
  hasNotes: boolFilterParam.describe(
    "When true, tracks with a non-empty notes document; when false, null or empty notes."
  ),
  hasLyrics: boolFilterParam.describe(
    "When true, tracks with a linked lyrics note; when false, tracks without one."
  ),
  hasImage: boolFilterParam.describe(
    "When true, tracks with their own cover artwork; when false, tracks without one."
  ),
  hasAudio: boolFilterParam.describe(
    "When true, tracks with at least one audio version; when false, tracks with none."
  ),
  hasSessions: boolFilterParam.describe(
    "When true, tracks with at least one linked DAW session; when false, tracks with none."
  ),
});
