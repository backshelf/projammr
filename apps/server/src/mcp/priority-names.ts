import { HTTPException } from "hono/http-exception";
import { z, type ZodRawShape, type ZodType } from "zod";
import { levelByName } from "../db/queries/priority-levels.js";
import type { EntityModule } from "../entities/types.js";

/**
 * An MCP caller names a priority level the way `get_project` lists it, by
 * name, never by id: an id means nothing to an agent until it has looked it
 * up, and a name it can read straight off the scale.
 */
const levelNameSchema = z
  .string()
  .trim()
  .min(1)
  .describe("A priority level's name, one of the project's scale");

/**
 * A write tool's input shape with `priorityId` swapped for `priority`, a
 * level name, on a module whose rows hold one. Any other module's shape is
 * left as it is.
 */
export function withLevelName(
  module: EntityModule,
  shape: ZodRawShape
): ZodRawShape {
  if (!module.priorityLevel) return shape;
  const named: Record<string, ZodType> = {
    ...shape,
    priority: levelNameSchema.optional(),
  };
  delete named.priorityId;
  return named;
}

/**
 * `input` with the level its `priority` names resolved to its id in
 * `projectId`, ready for the module's own write. A name the project's scale
 * does not have is a 404, as `set_status` answers an unknown status.
 */
export async function resolveLevelName(
  input: Record<string, unknown>,
  projectId: number
): Promise<Record<string, unknown>> {
  const { priority, ...rest } = input;
  if (priority === undefined) return rest;

  const name = levelNameSchema.parse(priority);
  const level = await levelByName(projectId, name);
  if (!level) {
    throw new HTTPException(404, {
      message: `No priority level named "${name}" in this project`,
    });
  }
  return { ...rest, priorityId: level.id };
}
