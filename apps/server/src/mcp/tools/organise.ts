import { HTTPException } from "hono/http-exception";
import { z, type ZodRawShape, type ZodType } from "zod";
import {
  assertStatusUsable,
  type MemberRole,
} from "../../db/queries/authorization.js";
import {
  deleteLabel,
  getLabelsInProject,
  labelSchema,
  setEntityLabels,
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
  getTracksInCollection,
  removeTrackFromCollection,
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

/** A loose result schema for tools whose row shape varies with the entity kind. */
const anyRowSchema = z.record(z.string(), z.unknown());

/** `z.enum` over the kinds of the given modules, for a tool that spans several. */
function kindEnum(modules: EntityModule[]) {
  const kinds = modules.map((m) => m.kind) as [EntityKind, ...EntityKind[]];
  return z.enum(kinds);
}

/** An entity's edit schema without its notes field: `write_notes` owns that one. */
function withoutNotesField(module: EntityModule): z.ZodObject<ZodRawShape> {
  const shape = {
    ...(module.schemas.edit as ZodType & { shape: ZodRawShape }).shape,
  };
  delete shape[module.notesField ?? "notes"];
  return z.object(shape);
}

/**
 * `create_<kind>` for every module the registry says MCP may create directly.
 * A priority level is named by `priority`, its name; left out, the project's
 * default applies.
 */
function createTool(module: EntityModule): AnyToolSpec {
  const one = module.label.toLowerCase();
  const input = module.priorityLevel
    ? z.object(
        withLevelName(
          module,
          (module.schemas.create as ZodType & { shape: ZodRawShape }).shape
        )
      )
    : module.schemas.create;
  return defineTool({
    name: `create_${module.kind}`,
    title: `Create ${one}`,
    description: `Creates a new ${one} in the project named by \`projectId\`.`,
    scope: "write",
    input,
    output: module.schemas.row,
    run: async (actor, rawInput) => {
      const { projectId } = rawInput as { projectId: number };
      const gate = await requireProject(actor, projectId, "editor");
      const input = await resolveLevelName(
        rawInput as Record<string, unknown>,
        gate.projectId
      );
      await module.assertWritable(input, gate.projectId);
      const row = await module.create(input, { userId: actor.id });
      await logCreate(
        activityContext(actor),
        module.kind,
        module.projectIdOfRow(row),
        row.id
      );
      return row;
    },
  });
}

/**
 * `update_<kind>` for every entity: a partial patch, everything but
 * notes/description. A priority level is named by `priority`, its name.
 */
function patchTool(module: EntityModule): AnyToolSpec {
  const one = module.label.toLowerCase();
  const input = z
    .object(withLevelName(module, withoutNotesField(module).shape))
    .extend({ id: z.number().int() });
  return defineTool({
    name: `update_${module.kind}`,
    title: `Update ${one}`,
    description:
      `Applies a partial update to one ${one}. Its notes are edited ` +
      "through the notes tools, not this one.",
    scope: "write",
    input,
    output: module.schemas.row,
    run: async (actor, rawInput) => {
      const { id, ...patch } = rawInput as { id: number } & Record<
        string,
        unknown
      >;
      const gate = await requireEntity(actor, module.kind, id, "editor");
      return patchEntityAs(
        actor,
        module,
        gate.projectId,
        id,
        await resolveLevelName(patch, gate.projectId)
      );
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
    "takes it.",
  scope: "write",
  input: z.object({
    kind: kindEnum(listModules),
    projectId: z.number().int(),
    selection: bulkSelectionSchema,
    patch: z.record(z.string(), z.unknown()),
  }),
  output: z.object({ updated: z.number() }),
  run: async (actor, { kind, projectId, selection, patch }) => {
    const module = ENTITIES[kind];
    if (!module.list) throw new HTTPException(404, { message: "Unknown kind" });
    const gate = await requireProject(actor, projectId, "editor");
    const parsedPatch = module.list.patchSchema.parse(
      module.priorityLevel
        ? await resolveLevelName(patch, gate.projectId)
        : patch
    );
    await module.assertWritable(parsedPatch, gate.projectId);
    // The REST parser drops a relation filter it cannot read as an id, which
    // would widen the patch to every row; resolve the name first.
    const resolvedSelection =
      "all" in selection
        ? bulkSelectionSchema.parse(
            await resolveRelationFilterName(module, selection, gate.projectId)
          )
        : selection;
    return module.list.bulkUpdate(
      gate.projectId,
      resolvedSelection,
      parsedPatch,
      actor.id
    );
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
  setLabelsTool,
  listLabelsTool,
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
  linkSessionsTool,
  addTrackRelationTool,
  removeTrackRelationTool,
  moveToProjectTool,
];
