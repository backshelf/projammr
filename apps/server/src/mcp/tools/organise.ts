import { HTTPException } from "hono/http-exception";
import { z, type ZodRawShape, type ZodType } from "zod";
import {
  assertStatusUsable,
  type MemberRole,
} from "../../db/queries/authorization.js";
import {
  bulkSetEntityLabels,
  createLabel,
  deleteLabel,
  getEntityLabelsBatch,
  getLabelsInProject,
  labelSchema,
  type LabelTarget,
  newLabelSchema,
  setEntityLabels,
  updateLabel,
  updateLabelSchema,
} from "../../db/queries/labels.js";
import {
  fieldKey,
  fieldValueSchema,
  getCustomFields,
} from "../../db/queries/custom-fields.js";
import { bulkSelectionSchema } from "../../db/queries/pagination.js";
import {
  createStatus,
  deleteStatus,
  getStatusesInProject,
  projectIdForStatus,
  updateStatus,
} from "../../db/queries/statuses.js";
import {
  editStatusSchema,
  newStatusSchema,
  statusSchema,
} from "../../db/schema/statuses.js";
import {
  ENTITIES,
  entityModules,
  type EntityKind,
  type EntityModule,
} from "../../entities/index.js";
import {
  addTrackRelation,
  deleteTrackRelation,
} from "../../db/queries/track-relations.js";
import { moveEntitySchema } from "../../db/queries/move.js";
import { trackRelationSchema } from "../../db/schema/tracks.js";
import { collectionTrackSchema } from "../../db/schema/collections.js";
import {
  addedCountSchema,
  addTracksToCollectionSchema,
  bulkAddTracksToCollection,
  collectionOrderResultSchema,
  getTracksInCollection,
  removeTrackFromCollection,
  setCollectionOrder,
  setCollectionOrderSchema,
  trackNumberSchema,
  tracksInCollectionSchema,
  updateTrackNumberInCollection,
} from "../../entities/collection/queries.js";
import {
  bulkMoveSessions,
  sessionMovesSchema,
} from "../../entities/session/queries.js";
import { spendToken } from "../../middleware/rate-limit.js";
import {
  logArchives,
  logCreate,
  logDelete,
  logUpdate,
} from "../../routes/activity-log.js";
import { activityContext, type Actor } from "../actor.js";
import { requireEntity, requireProject } from "../authorize.js";
import { patchEntityAs } from "../entity-writes.js";
import { resolveLevelName, withLevelName } from "../priority-names.js";
import {
  resolveRelationFilterName,
  resolveRelationTypeName,
  typeNameSchema,
} from "../relation-type-names.js";
import { defineTool, type AnyToolSpec } from "../spec.js";
import { writeLyrics, writeNotes } from "./notes.js";

/** A loose result schema for tools whose row shape varies with the entity kind. */
const anyRowSchema = z.record(z.string(), z.unknown());

/** `z.enum` over the kinds of the given modules, for a tool that spans several. */
function kindEnum(modules: EntityModule[]) {
  const kinds = modules.map((m) => m.kind) as [EntityKind, ...EntityKind[]];
  return z.enum(kinds);
}

const labelNameArraySchema = z.array(z.string().trim().min(1));

type LabelPatch = {
  labels?: string[];
  addLabels?: string[];
  removeLabels?: string[];
};

function hasLabelPatch(patch: LabelPatch): boolean {
  return (
    patch.labels !== undefined ||
    patch.addLabels !== undefined ||
    patch.removeLabels !== undefined
  );
}

function assertValidLabelPatch(patch: LabelPatch): void {
  if (
    patch.labels !== undefined &&
    (patch.addLabels !== undefined || patch.removeLabels !== undefined)
  ) {
    throw new HTTPException(400, {
      message: "Cannot combine `labels` with `addLabels` or `removeLabels`",
    });
  }
}

function assertNoImageField(obj: Record<string, unknown>): void {
  if ("image" in obj) {
    throw new HTTPException(400, {
      message:
        "Cover artwork cannot be set here; use `set_cover` or `remove_cover`.",
    });
  }
}

/**
 * Ensures every name in `namesToCreate` exists as a label in `projectId`,
 * creating missing ones and returning a map of all project label names to ids.
 */
async function ensureProjectLabelIds(
  projectId: number,
  namesToCreate: readonly string[],
  actorId: string
): Promise<Map<string, number>> {
  const existing = await getLabelsInProject(projectId);
  const byName = new Map(existing.map((l) => [l.name, l.id]));
  const missing = [...new Set(namesToCreate)].filter((n) => !byName.has(n));
  if (missing.length === 0) return byName;

  let raced = false;
  for (const name of missing) {
    try {
      const created = await createLabel(projectId, { name }, actorId);
      byName.set(created.name, created.id);
    } catch (err) {
      if (err instanceof HTTPException && err.status === 409) {
        raced = true;
      } else {
        throw err;
      }
    }
  }
  if (raced) {
    for (const label of await getLabelsInProject(projectId)) {
      byName.set(label.name, label.id);
    }
  }
  return byName;
}

/**
 * Applies `labels` (full replacement) or `addLabels`/`removeLabels`
 * (incremental) by name to one or more entities, auto-creating missing labels
 * in the project. Returns how many entities changed.
 */
async function applyLabelPatch(
  projectId: number,
  target: LabelTarget,
  entityIds: number[],
  patch: LabelPatch,
  actorId: string
): Promise<number> {
  if (entityIds.length === 0 || !hasLabelPatch(patch)) return 0;

  if (patch.labels !== undefined) {
    const names = [...new Set(patch.labels)];
    const byName = await ensureProjectLabelIds(projectId, names, actorId);
    const targetIds = names
      .map((n) => byName.get(n))
      .filter((id): id is number => id !== undefined);

    if (entityIds.length === 1) {
      await setEntityLabels(
        projectId,
        target,
        entityIds[0]!,
        { labelIds: targetIds },
        actorId
      );
      return 1;
    }

    const beforeMap = await getEntityLabelsBatch(target, entityIds);
    const targetIdSet = new Set(targetIds);
    let updated = 0;
    for (const id of entityIds) {
      const before = beforeMap.get(id) ?? [];
      if (
        before.length === targetIdSet.size &&
        before.every((l) => targetIdSet.has(l.id))
      ) {
        continue;
      }
      await setEntityLabels(
        projectId,
        target,
        id,
        { labelIds: targetIds },
        actorId
      );
      updated++;
    }
    return updated;
  }

  const addNames = patch.addLabels ?? [];
  const removeNames = patch.removeLabels ?? [];
  const byName = await ensureProjectLabelIds(projectId, addNames, actorId);
  const addIds = [...new Set(addNames)]
    .map((n) => byName.get(n))
    .filter((id): id is number => id !== undefined);
  const removeIds = [...new Set(removeNames)]
    .map((n) => byName.get(n))
    .filter((id): id is number => id !== undefined);

  if (addIds.length === 0 && removeIds.length === 0) return 0;
  return bulkSetEntityLabels(
    projectId,
    target,
    entityIds,
    { add: addIds, remove: removeIds },
    actorId
  );
}

/**
 * An entity's MCP write schema shape: omits `image` (cover artwork goes
 * through `set_cover` / `remove_cover`), omits notes/description on edit
 * (`write_notes` owns that), swaps `priorityId` for `priority` by name, and
 * adds inline label fields for label-capable entities.
 */
function mcpWriteShape(
  module: EntityModule,
  mode: "create" | "edit"
): ZodRawShape {
  const shape: Record<string, z.core.$ZodType> = {
    ...(module.schemas[mode] as ZodType & { shape: ZodRawShape }).shape,
  };
  delete shape.image;
  if (mode === "edit") {
    delete shape[module.notesField ?? "notes"];
  }
  const named: Record<string, z.core.$ZodType> = {
    ...withLevelName(module, shape),
  };
  if (module.labels) {
    if (mode === "create") {
      named.labels = labelNameArraySchema
        .optional()
        .describe(
          "Initial labels by name; names not yet in the project are created."
        );
    } else {
      named.labels = labelNameArraySchema
        .optional()
        .describe(
          "Replace the entity's full label set by name (missing names are created). " +
            "Cannot be combined with `addLabels` or `removeLabels`."
        );
      named.addLabels = labelNameArraySchema
        .optional()
        .describe(
          "Add labels by name without removing existing ones (missing names are created)."
        );
      named.removeLabels = labelNameArraySchema
        .optional()
        .describe("Remove labels by name, leaving other labels intact.");
    }
  }
  return named;
}

/**
 * `create_<kind>` for every module the registry says MCP may create directly.
 * A priority level is named by `priority`, its name; left out, the project's
 * default applies.
 */
function createTool(module: EntityModule): AnyToolSpec {
  const one = module.label.toLowerCase();
  const input = z.object(mcpWriteShape(module, "create")).strict();
  return defineTool({
    name: `create_${module.kind}`,
    title: `Create ${one}`,
    description:
      `Creates a new ${one} in the project named by \`projectId\`.` +
      (module.labels
        ? " Pass `labels` to set initial labels by name (missing names are created)."
        : "") +
      (module.image
        ? " Cover artwork is managed through `set_cover` and `remove_cover`."
        : ""),
    scope: "write",
    input,
    output: module.schemas.row,
    run: async (actor, rawInput) => {
      const record = rawInput as Record<string, unknown>;
      assertNoImageField(record);
      const { projectId, labels, ...rest } = record as {
        projectId: number;
        labels?: string[];
      } & Record<string, unknown>;
      const gate = await requireProject(actor, projectId, "editor");
      const input = await resolveLevelName(
        { projectId, ...rest },
        gate.projectId
      );
      await module.assertWritable(input, gate.projectId);
      const row = await module.create(input, { userId: actor.id });
      const createdProjectId = module.projectIdOfRow(row);
      await logCreate(
        activityContext(actor),
        module.kind,
        createdProjectId,
        row.id
      );
      if (module.labels && labels !== undefined) {
        await applyLabelPatch(
          createdProjectId,
          module.labels,
          [row.id],
          { labels },
          actor.id
        );
      }
      return row;
    },
  });
}

/**
 * `update_<kind>` for every entity: a partial patch, everything but
 * notes/description and cover image. A priority level is named by `priority`,
 * its name; label-capable entities also take `labels`, `addLabels` and
 * `removeLabels`.
 */
function patchTool(module: EntityModule): AnyToolSpec {
  const one = module.label.toLowerCase();
  const input = z
    .object(mcpWriteShape(module, "edit"))
    .extend({ id: z.number().int() })
    .strict();
  return defineTool({
    name: `update_${module.kind}`,
    title: `Update ${one}`,
    description:
      `Applies a partial update to one ${one}. Its notes are edited ` +
      "through the notes tools, not this one." +
      (module.labels
        ? " Labels can be replaced with `labels` or adjusted with `addLabels`/`removeLabels`."
        : "") +
      (module.image
        ? " Cover artwork is managed through `set_cover` and `remove_cover`."
        : ""),
    scope: "write",
    input,
    output: module.schemas.row,
    run: async (actor, rawInput) => {
      const record = rawInput as Record<string, unknown>;
      assertNoImageField(record);
      const { id, labels, addLabels, removeLabels, ...rawPatch } = record as {
        id: number;
        labels?: string[];
        addLabels?: string[];
        removeLabels?: string[];
      } & Record<string, unknown>;
      const labelPatch: LabelPatch = { labels, addLabels, removeLabels };
      assertValidLabelPatch(labelPatch);
      const gate = await requireEntity(actor, module.kind, id, "editor");
      const resolved = await resolveLevelName(rawPatch, gate.projectId);
      const row =
        Object.keys(resolved).length > 0
          ? await patchEntityAs(actor, module, gate.projectId, id, resolved)
          : await module.row(id);
      if (!row) {
        throw new HTTPException(404, { message: `${module.label} not found` });
      }
      if (module.labels && hasLabelPatch(labelPatch)) {
        await applyLabelPatch(
          gate.projectId,
          module.labels,
          [id],
          labelPatch,
          actor.id
        );
      }
      return row;
    },
  });
}

/** `delete_<kind>` for every entity, gated at the module's own delete role. */
function deleteTool(module: EntityModule): AnyToolSpec {
  const one = module.label.toLowerCase();
  return defineTool({
    name: `delete_${module.kind}`,
    title: `Delete ${one}`,
    description: `Permanently deletes one ${one}.`,
    scope: "write",
    destructive: true,
    input: z.object({ id: z.number().int() }),
    output: module.schemas.row,
    run: async (actor, { id }) => {
      const minRole: MemberRole = module.deleteRole ?? "editor";
      await requireEntity(actor, module.kind, id, minRole);
      const deleted = await module.remove(id);
      if (module.recordsDelete) {
        await logDelete(
          activityContext(actor),
          module.kind,
          module.projectIdOfRow(deleted),
          deleted.id
        );
      }
      return deleted;
    },
  });
}

const listModules = entityModules().filter((m) => m.list);

const bulkUpdateTool = defineTool({
  name: "bulk_update",
  title: "Bulk update",
  description:
    "Applies one patch to many rows of one entity kind at once, selected by " +
    "an id list or by `all: true` plus the paginated list's filters — the " +
    "same grammar `PATCH /:kind/bulk` takes, except that a priority level is " +
    "named by `priority`, its name in the project's scale, and a selection's " +
    "`relation` filter is `any` or a relation type's name, as `list_tracks` " +
    "takes it. For label-capable kinds, also accepts `labels` (replace full " +
    "set), `addLabels`, or `removeLabels` by name (top-level or inside " +
    "`patch`), auto-creating missing label names in the project.",
  scope: "write",
  input: z.object({
    kind: kindEnum(listModules),
    projectId: z.number().int(),
    selection: bulkSelectionSchema,
    patch: z.record(z.string(), z.unknown()).optional(),
    labels: labelNameArraySchema
      .optional()
      .describe(
        "Replace every selected row's full label set by name (missing names are created)."
      ),
    addLabels: labelNameArraySchema
      .optional()
      .describe(
        "Add labels by name to every selected row (missing names are created)."
      ),
    removeLabels: labelNameArraySchema
      .optional()
      .describe("Remove labels by name from every selected row."),
  }),
  output: z.object({ updated: z.number() }),
  run: async (
    actor,
    { kind, projectId, selection, patch, labels, addLabels, removeLabels }
  ) => {
    const module = ENTITIES[kind];
    if (!module.list) throw new HTTPException(404, { message: "Unknown kind" });
    const gate = await requireProject(actor, projectId, "editor");

    const rawPatch: Record<string, unknown> = { ...(patch ?? {}) };
    assertNoImageField(rawPatch);

    const pickLabelArg = (
      key: keyof LabelPatch,
      topLevel: string[] | undefined
    ): string[] | undefined => {
      const fromPatch = key in rawPatch ? rawPatch[key] : undefined;
      delete rawPatch[key];
      if (topLevel !== undefined && fromPatch !== undefined) {
        throw new HTTPException(400, {
          message: `Pass \`${key}\` either at top level or inside \`patch\`, not both`,
        });
      }
      if (fromPatch !== undefined) return labelNameArraySchema.parse(fromPatch);
      return topLevel;
    };

    const labelPatch: LabelPatch = {
      labels: pickLabelArg("labels", labels),
      addLabels: pickLabelArg("addLabels", addLabels),
      removeLabels: pickLabelArg("removeLabels", removeLabels),
    };
    assertValidLabelPatch(labelPatch);
    if (hasLabelPatch(labelPatch) && !module.labels) {
      throw new HTTPException(400, {
        message: `${module.label} does not support labels`,
      });
    }

    const parsedPatch = module.list.patchSchema.parse(
      module.priorityLevel
        ? await resolveLevelName(rawPatch, gate.projectId)
        : rawPatch
    ) as Record<string, unknown>;
    await module.assertWritable(parsedPatch, gate.projectId);
    // The REST parser drops a relation filter it cannot read as an id, which
    // would widen the patch to every row; resolve the name first.
    const resolvedSelection =
      "all" in selection
        ? bulkSelectionSchema.parse(
            await resolveRelationFilterName(module, selection, gate.projectId)
          )
        : selection;

    const hasScalarPatch = Object.keys(parsedPatch).length > 0;
    if (!hasLabelPatch(labelPatch)) {
      if (!hasScalarPatch) return { updated: 0 };
      return module.list.bulkUpdate(
        gate.projectId,
        resolvedSelection,
        parsedPatch,
        actor.id
      );
    }

    // Resolve selection once before any write so a scalar column update cannot
    // change which rows receive the label update.
    const ids = await module.list.selectIds(gate.projectId, resolvedSelection);
    if (ids.length === 0) return { updated: 0 };
    let scalarUpdated = 0;
    if (hasScalarPatch) {
      scalarUpdated = (
        await module.list.bulkUpdate(
          gate.projectId,
          { ids },
          parsedPatch,
          actor.id
        )
      ).updated;
    }
    const labelUpdated = await applyLabelPatch(
      gate.projectId,
      module.labels!,
      ids,
      labelPatch,
      actor.id
    );
    return { updated: Math.max(scalarUpdated, labelUpdated) };
  },
});

const batchTrackUpdateItemSchema = z
  .object({
    ...mcpWriteShape(ENTITIES.track, "edit"),
    id: z.number().int(),
    notes: z
      .string()
      .optional()
      .describe("Replace the track's notes from markdown."),
    lyrics: z
      .string()
      .optional()
      .describe(
        "Write the track's lyrics from markdown, creating and linking a note if none exists."
      ),
  })
  .strict();

const batchUpdateTracksTool = defineTool({
  name: "batch_update_tracks",
  title: "Batch update tracks",
  description:
    "Applies heterogeneous per-track updates across up to 100 tracks in one " +
    "project in a single call. Each item may patch track fields (with " +
    "`priority` by name), replace or adjust labels (`labels`, `addLabels`, " +
    "`removeLabels`), replace `notes` from markdown, and/or write `lyrics` " +
    "from markdown. Cover artwork is managed through `set_cover` and `remove_cover`.",
  scope: "write",
  input: z
    .object({
      projectId: z.number().int(),
      updates: z.array(batchTrackUpdateItemSchema).min(1).max(100),
    })
    .strict(),
  output: z.object({
    updated: z.number(),
    trackIds: z.array(z.number()),
  }),
  run: async (actor, { projectId, updates }) => {
    const gate = await requireProject(actor, projectId, "editor");
    const trackIds = updates.map((u) => u.id);
    if (new Set(trackIds).size !== trackIds.length) {
      throw new HTTPException(400, {
        message: "Duplicate track IDs in updates",
      });
    }
    await ENTITIES.track.assertInProject(trackIds, gate.projectId);

    const prepared = await Promise.all(
      updates.map(async (rawItem) => {
        const record = rawItem as Record<string, unknown>;
        assertNoImageField(record);
        const { id, labels, addLabels, removeLabels, notes, lyrics, ...rest } =
          record as {
            id: number;
            labels?: string[];
            addLabels?: string[];
            removeLabels?: string[];
            notes?: string;
            lyrics?: string;
          } & Record<string, unknown>;
        const labelPatch: LabelPatch = { labels, addLabels, removeLabels };
        assertValidLabelPatch(labelPatch);
        const resolved = await resolveLevelName(rest, gate.projectId);
        if (Object.keys(resolved).length > 0) {
          await ENTITIES.track.assertWritable(resolved, gate.projectId);
        }
        return { id, resolved, labelPatch, notes, lyrics };
      })
    );

    for (const item of prepared) {
      if (Object.keys(item.resolved).length > 0) {
        await patchEntityAs(
          actor,
          ENTITIES.track,
          gate.projectId,
          item.id,
          item.resolved
        );
      }
      if (hasLabelPatch(item.labelPatch)) {
        await applyLabelPatch(
          gate.projectId,
          "track",
          [item.id],
          item.labelPatch,
          actor.id
        );
      }
      if (item.notes !== undefined) {
        await writeNotes(actor, "track", item.id, item.notes);
      }
      if (item.lyrics !== undefined) {
        await writeLyrics(actor, item.id, item.lyrics);
      }
    }

    return { updated: prepared.length, trackIds };
  },
});

const labelModules = entityModules().filter((m) => m.labels);

const setLabelsTool = defineTool({
  name: "set_labels",
  title: "Set labels",
  description:
    "Replaces one entity's full label set by name. A name not yet in the " +
    "project is created.",
  scope: "write",
  input: z.object({
    kind: kindEnum(labelModules),
    id: z.number().int(),
    names: z.array(z.string().trim().min(1)),
  }),
  output: z.array(labelSchema),
  run: async (actor, { kind, id, names }) => {
    const module = ENTITIES[kind];
    if (!module.labels)
      throw new HTTPException(404, { message: "Unknown kind" });
    const gate = await requireEntity(actor, kind, id, "editor");
    return setEntityLabels(
      gate.projectId,
      module.labels,
      id,
      { names },
      actor.id
    );
  },
});

const listLabelsTool = defineTool({
  name: "list_labels",
  title: "List labels",
  description: "Every label defined in a project.",
  scope: "read",
  input: z.object({ projectId: z.number().int() }),
  output: z.array(labelSchema),
  run: async (actor, { projectId }) => {
    await requireProject(actor, projectId, "viewer");
    return getLabelsInProject(projectId);
  },
});

const createLabelTool = defineTool({
  name: "create_label",
  title: "Create label",
  description:
    "Creates a new label in a project, with an optional hex colour (`#rrggbb` or `#rrggbbaa`).",
  scope: "write",
  input: newLabelSchema.extend({ projectId: z.number().int() }),
  output: labelSchema,
  run: async (actor, { projectId, ...data }) => {
    await requireProject(actor, projectId, "editor");
    return createLabel(projectId, data, actor.id);
  },
});

const updateLabelTool = defineTool({
  name: "update_label",
  title: "Update label",
  description:
    "Renames and/or recolours a project label. Provide at least one of `name` or `colourHex`.",
  scope: "write",
  input: newLabelSchema
    .partial()
    .extend({
      projectId: z.number().int(),
      labelId: z.number().int(),
    })
    .refine(
      (patch) => patch.name !== undefined || patch.colourHex !== undefined,
      { message: "Provide a name or a colourHex" }
    ),
  output: labelSchema,
  run: async (actor, { projectId, labelId, name, colourHex }) => {
    await requireProject(actor, projectId, "editor");
    return updateLabel(
      projectId,
      labelId,
      updateLabelSchema.parse({ name, colourHex }),
      actor.id
    );
  },
});

const deleteLabelTool = defineTool({
  name: "delete_label",
  title: "Delete label",
  description:
    "Deletes a label from a project, removing it from every entity that carries it.",
  scope: "write",
  destructive: true,
  input: z.object({ projectId: z.number().int(), labelId: z.number().int() }),
  output: labelSchema,
  run: async (actor, { projectId, labelId }) => {
    await requireProject(actor, projectId, "editor");
    return deleteLabel(projectId, labelId, actor.id);
  },
});

const statusModules = entityModules().filter((m) => m.status);

const setStatusTool = defineTool({
  name: "set_status",
  title: "Set status",
  description:
    "Moves a track or collection to a status named in the project's own " +
    "vocabulary (its own statuses plus the global ones). The name must match exactly.",
  scope: "write",
  input: z.object({
    kind: kindEnum(statusModules),
    id: z.number().int(),
    statusName: z.string().trim().min(1),
  }),
  output: anyRowSchema,
  run: async (actor, { kind, id, statusName }) => {
    const module = ENTITIES[kind];
    if (!module.status)
      throw new HTTPException(404, { message: "Unknown kind" });
    const gate = await requireEntity(actor, kind, id, "editor");
    const candidates = await getStatusesInProject(gate.projectId);
    const status = candidates.find((s) => s.name === statusName);
    if (!status) {
      throw new HTTPException(404, {
        message: `No status named "${statusName}" in this project`,
      });
    }
    await assertStatusUsable(status.id, gate.projectId);

    const before = await module.row(id);
    const after = await module.status.set(id, status.id);
    if (before) {
      await logUpdate(
        activityContext(actor),
        module.kind,
        id,
        gate.projectId,
        before,
        after
      );
    }
    return after;
  },
});

const fieldModules = entityModules().filter((m) => m.customFields);

const setFieldTool = defineTool({
  name: "set_field",
  title: "Set field",
  description:
    "Sets one custom field on a track or collection, naming the field by " +
    "its exact name in the project (get_project lists them). The value is " +
    "typed by the field: text or a URL as a string, a date as YYYY-MM-DD, " +
    "a number, true or false for a checkbox, and an option's label or id " +
    "for a select. null clears it.",
  scope: "write",
  input: z.object({
    kind: kindEnum(fieldModules),
    id: z.number().int(),
    field: z.string().trim().min(1),
    value: fieldValueSchema.nullable(),
  }),
  output: anyRowSchema,
  run: async (actor, { kind, id, field, value }) => {
    const module = ENTITIES[kind];
    if (!module.customFields) {
      throw new HTTPException(404, { message: "Unknown kind" });
    }
    const gate = await requireEntity(actor, kind, id, "editor");
    const named = (
      await getCustomFields(gate.projectId, module.customFields)
    ).find((candidate) => candidate.name === field);
    if (!named) {
      throw new HTTPException(404, {
        message: `No ${kind} field named "${field}" in this project`,
      });
    }
    return patchEntityAs(actor, module, gate.projectId, id, {
      fields: { [fieldKey(named.id)]: value },
    });
  },
});

/**
 * `archive_<kind>` or `unarchive_<kind>` for a module that declares `archive`.
 * The module's hook writes only the rows not already in the target state, and
 * the activity log gets a row for exactly those, so repeating a call succeeds
 * and logs nothing.
 */
function archiveTool(module: EntityModule, archived: boolean) {
  const archive = module.archive;
  if (!archive) throw new Error(`${module.kind} cannot be archived`);
  const verb = archived ? "archive" : "unarchive";
  return defineTool({
    name: `${verb}_${module.kind}`,
    title: `${archived ? "Archive" : "Unarchive"} ${module.label}`,
    description:
      `${archived ? "Archives" : "Unarchives"} a ${module.label}` +
      (archived
        ? "; its sessions are archived with it. An archived " +
          `${module.label} and its sessions leave the list tools unless ` +
          "`archived` is passed"
        : "; its sessions come back with it") +
      `. ${archived ? "Archiving" : "Unarchiving"} one that is already ` +
      `${archived ? "archived" : "live"} succeeds and changes nothing.`,
    scope: "write",
    input: z.object({ id: z.number().int() }),
    output: anyRowSchema,
    run: async (actor, { id }) => {
      const gate = await requireEntity(actor, module.kind, id, "editor");
      const changed = await archive.set([id], archived);
      await logArchives(
        activityContext(actor),
        module.kind,
        gate.projectId,
        changed.ids,
        archived ? "archived" : "unarchived"
      );
      const row = await module.row(id);
      if (!row)
        throw new HTTPException(404, { message: `${module.label} not found` });
      return row;
    },
  });
}

const archivableModules = entityModules().filter((m) => m.archive);

/**
 * Gates a write to one status at editor on the project that owns it. A global
 * status belongs to no project, so it passes through to `updateStatus` or
 * `deleteStatus`, which refuse it with their own 403.
 */
async function requireStatusWrite(actor: Actor, id: number): Promise<void> {
  const resolution = await projectIdForStatus(id);
  if (resolution == null) {
    throw new HTTPException(404, { message: "Status not found" });
  }
  if (resolution !== "global") {
    await requireProject(actor, resolution, "editor");
  }
}

const createStatusTool = defineTool({
  name: "create_status",
  title: "Create status",
  description: "Creates a new status in a project's vocabulary.",
  scope: "write",
  input: newStatusSchema.extend({ projectId: z.number().int() }),
  output: statusSchema,
  run: async (actor, input) => {
    await requireProject(actor, input.projectId, "editor");
    return createStatus(input, actor.id);
  },
});

const updateStatusTool = defineTool({
  name: "update_status",
  title: "Update status",
  description:
    "Updates a project's own status (name, percentage, description or colour). " +
    "A global status cannot be changed.",
  scope: "write",
  input: editStatusSchema.extend({ id: z.number().int() }),
  output: statusSchema,
  run: async (actor, { id, ...patch }) => {
    await requireStatusWrite(actor, id);
    return updateStatus(id, patch, actor.id);
  },
});

const deleteStatusTool = defineTool({
  name: "delete_status",
  title: "Delete status",
  description:
    "Deletes a project's own status. A global status cannot be deleted.",
  scope: "write",
  destructive: true,
  input: z.object({ id: z.number().int() }),
  output: statusSchema,
  run: async (actor, { id }) => {
    await requireStatusWrite(actor, id);
    return deleteStatus(id, actor.id);
  },
});

const addTracksToCollectionTool = defineTool({
  name: "add_tracks_to_collection",
  title: "Add tracks to collection",
  description:
    "Adds tracks from the collection's project to a collection, unnumbered; " +
    "a track already in it keeps its place.",
  scope: "write",
  idempotent: true,
  input: addTracksToCollectionSchema.extend({
    collectionId: z.number().int(),
  }),
  output: addedCountSchema,
  run: async (actor, { collectionId, trackIds }) => {
    const gate = await requireEntity(
      actor,
      "collection",
      collectionId,
      "editor"
    );
    await ENTITIES.track.assertInProject(trackIds, gate.projectId);
    return bulkAddTracksToCollection(collectionId, trackIds, actor.id);
  },
});

const removeTrackFromCollectionTool = defineTool({
  name: "remove_track_from_collection",
  title: "Remove track from collection",
  description:
    "Takes a track out of a collection, dropping its track number there; " +
    "the track itself is kept.",
  scope: "write",
  destructive: true,
  input: z.object({
    collectionId: z.number().int(),
    trackId: z.number().int(),
  }),
  output: collectionTrackSchema,
  run: async (actor, { collectionId, trackId }) => {
    await requireEntity(actor, "collection", collectionId, "editor");
    return removeTrackFromCollection(collectionId, trackId, actor.id);
  },
});

const setTrackNumberTool = defineTool({
  name: "set_track_number",
  title: "Set track number",
  description:
    "Sets a track's number in a collection. When another track already holds " +
    "that number, the two swap. Answers the collection's tracks in their new order.",
  scope: "write",
  idempotent: true,
  input: trackNumberSchema.extend({
    collectionId: z.number().int(),
    trackId: z.number().int(),
  }),
  output: z.object({ tracks: tracksInCollectionSchema }),
  run: async (actor, { collectionId, trackId, trackNumber }) => {
    await requireEntity(actor, "collection", collectionId, "editor");
    await updateTrackNumberInCollection(
      collectionId,
      trackId,
      trackNumber,
      actor.id
    );
    return { tracks: await getTracksInCollection(collectionId) };
  },
});

const setCollectionOrderTool = defineTool({
  name: "set_collection_order",
  title: "Set collection order",
  description:
    "Atomically adds any missing tracks to a collection and numbers " +
    "`trackIds` `1..N` in exact order. Other tracks already in the collection " +
    "stay as unnumbered members. All `trackIds` must belong to the " +
    "collection's project and contain no duplicates.",
  scope: "write",
  idempotent: true,
  input: setCollectionOrderSchema
    .extend({ collectionId: z.number().int() })
    .strict(),
  output: collectionOrderResultSchema,
  run: async (actor, { collectionId, trackIds }) => {
    const gate = await requireEntity(
      actor,
      "collection",
      collectionId,
      "editor"
    );
    await ENTITIES.track.assertInProject(trackIds, gate.projectId);
    return setCollectionOrder(collectionId, trackIds, actor.id);
  },
});

const linkSessionsTool = defineTool({
  name: "link_sessions",
  title: "Link sessions",
  description:
    "Re-links sessions to tracks in one write: each move sets a session's " +
    "track (`null` unlinks it) and whether it is that track's main session. " +
    "Making a session main clears the track's previous main.",
  scope: "write",
  idempotent: true,
  input: sessionMovesSchema,
  output: z.object({ moved: z.number() }),
  run: async (actor, { moves }) => {
    const [first] = moves;
    if (!first) return { moved: 0 };
    const gate = await requireEntity(
      actor,
      "session",
      first.sessionId,
      "editor"
    );
    spendToken("session-moves", actor.id);
    await bulkMoveSessions(moves, gate.projectId, actor.id);
    return { moved: moves.length };
  },
});

const addTrackRelationTool = defineTool({
  name: "add_track_relation",
  title: "Add track relation",
  description:
    "Records `fromTrackId` as a derivative of `toTrackId` (a remix, a cover, " +
    "…); both tracks must be in the same project. `relation` names one of " +
    "the project's relation types (`get_project` lists them).",
  scope: "write",
  input: z.object({
    fromTrackId: z.number().int(),
    toTrackId: z.number().int().positive(),
    relation: typeNameSchema,
  }),
  output: trackRelationSchema,
  run: async (actor, { fromTrackId, toTrackId, relation }) => {
    const gate = await requireEntity(actor, "track", fromTrackId, "editor");
    await ENTITIES.track.assertInProject([toTrackId], gate.projectId);
    const relationTypeId = await resolveRelationTypeName(
      gate.projectId,
      relation
    );
    return addTrackRelation(
      { fromTrackId, toTrackId, relationTypeId },
      actor.id
    );
  },
});

const removeTrackRelationTool = defineTool({
  name: "remove_track_relation",
  title: "Remove track relation",
  description:
    "Deletes one relation touching a track, by the relation's id; both tracks are kept.",
  scope: "write",
  destructive: true,
  input: z.object({ trackId: z.number().int(), relationId: z.number().int() }),
  output: trackRelationSchema,
  run: async (actor, { trackId, relationId }) => {
    await requireEntity(actor, "track", trackId, "editor");
    return deleteTrackRelation(trackId, relationId, actor.id);
  },
});

const movableModules = entityModules().filter((m) => m.move);

const moveToProjectTool = defineTool({
  name: "move_to_project",
  title: "Move to project",
  description:
    "Moves a track, collection or session into another project where the " +
    "caller is an editor. What it exclusively owns goes with it; what it " +
    "shared with rows that stay behind is unlinked.",
  scope: "write",
  destructive: true,
  input: moveEntitySchema.extend({
    kind: kindEnum(movableModules),
    id: z.number().int(),
  }),
  output: anyRowSchema,
  run: async (actor, { kind, id, projectId }) => {
    const module = ENTITIES[kind];
    if (!module.move) throw new HTTPException(404, { message: "Unknown kind" });
    await requireEntity(actor, kind, id, "editor");
    spendToken("moves", actor.id);
    return module.move(id, projectId, actor.id);
  },
});

/**
 * The organising tools: creating, updating, deleting and bulk-patching
 * entities, the label and status vocabularies they draw on, collection
 * membership and order, session links, track relations and moves between
 * projects. One `create`,
 * `update` and `delete` tool per module the registry says MCP should expose
 * for that operation — `entityModules()` drives the set, so a fifth entity
 * gains these tools by declaring its module, not by a case added here.
 */
export const ORGANISE_TOOLS: AnyToolSpec[] = [
  ...entityModules()
    .filter((m) => m.mcpCreate !== false)
    .map(createTool),
  ...entityModules().map(patchTool),
  ...entityModules().map(deleteTool),
  bulkUpdateTool,
  batchUpdateTracksTool,
  setLabelsTool,
  listLabelsTool,
  createLabelTool,
  updateLabelTool,
  deleteLabelTool,
  setStatusTool,
  setFieldTool,
  ...archivableModules.flatMap((m) => [
    archiveTool(m, true),
    archiveTool(m, false),
  ]),
  createStatusTool,
  updateStatusTool,
  deleteStatusTool,
  addTracksToCollectionTool,
  removeTrackFromCollectionTool,
  setTrackNumberTool,
  setCollectionOrderTool,
  linkSessionsTool,
  addTrackRelationTool,
  removeTrackRelationTool,
  moveToProjectTool,
];
