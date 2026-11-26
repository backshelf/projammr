import type { EntityModule } from "../entities/index.js";
import { logUpdate } from "../routes/activity-log.js";
import { activityContext, type Actor } from "./actor.js";

/**
 * Patches one entity row as the MCP caller, the same way `PATCH /:id` does:
 * the foreign ids the patch names must sit in the row's project, and the
 * change lands in the activity feed under the caller. The caller has already
 * gated `id` at editor and passes the project that gate resolved.
 */
export async function patchEntityAs(
  actor: Actor,
  module: EntityModule,
  projectId: number,
  id: number,
  patch: unknown
) {
  await module.assertWritable(patch, projectId);
  const before = await module.row(id);
  const after = await module.update(id, patch);
  if (before) {
    await logUpdate(
      activityContext(actor),
      module.kind,
      id,
      module.projectIdOfRow(after),
      before,
      after,
      module.activityIgnoredFields
    );
  }
  return after;
}
