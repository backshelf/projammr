import { HTTPException } from "hono/http-exception";
import { z, type ZodType } from "zod";
import { relationTypeByName } from "../db/queries/track-relation-types.js";
import type { EntityModule } from "../entities/types.js";

/**
 * An MCP caller names a relation type the way `get_project` lists it, by
 * name, never by id: an id means nothing to an agent until it has looked it
 * up, and a name it can read straight off the list.
 */
export const typeNameSchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "A relation type's name, one of the project's `relationTypes` (`get_project`)"
  );

/**
 * The id of `projectId`'s relation type named `name`. A name the list does
 * not have is a 404, as an unknown priority level name is.
 */
export async function resolveRelationTypeName(
  projectId: number,
  name: string
): Promise<number> {
  const type = await relationTypeByName(projectId, name);
  if (!type) {
    throw new HTTPException(404, {
      message: `No relation type named "${name}" in this project`,
    });
  }
  return type.id;
}

/**
 * A listing's query schema with its `relation` filter taking `any` or a type
 * name instead of a type id, on a module whose listing filters by one. Any
 * other module's schema is left as it is.
 */
export function withRelationFilterName(
  module: EntityModule,
  querySchema: ZodType
): ZodType {
  if (!module.relationFilter || !(querySchema instanceof z.ZodObject)) {
    return querySchema;
  }
  return querySchema.extend({
    relation: z
      .union([z.literal("any"), typeNameSchema])
      .optional()
      .describe(
        "`any` for tracks with any relation, or a relation type's name, one of the project's `relationTypes` (`get_project`)"
      ),
  });
}

/**
 * `query` with the type its `relation` filter names resolved to its id in
 * `projectId`, ready for the module's own listing.
 */
export async function resolveRelationFilterName(
  module: EntityModule,
  query: Record<string, unknown>,
  projectId: number
): Promise<Record<string, unknown>> {
  const { relation } = query;
  if (!module.relationFilter || relation === undefined || relation === "any") {
    return query;
  }
  return {
    ...query,
    relation: await resolveRelationTypeName(
      projectId,
      typeNameSchema.parse(relation)
    ),
  };
}
