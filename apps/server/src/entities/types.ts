import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import type { Tx } from "../db/index.js";
import type {
  MemberRole,
  ProjectResolution,
} from "../db/queries/authorization.js";
import type { LabelTarget } from "../db/queries/labels.js";
import type { BulkSelection, Paginated } from "../db/queries/pagination.js";
import type { CustomFieldKind } from "../db/schema/custom-fields.js";
import type {
  rawCommentTargetEnum,
  rawEntityKindEnum,
} from "../db/schema/enums.js";
import type {
  ProjectIdResolver,
  RolePolicy,
} from "../middleware/authorize-project.js";

/** The four entities that carry artwork, labels, activity and comments. */
export type EntityKind = (typeof rawEntityKindEnum)[number];

/** The entities, plus the audio version a timestamped comment hangs off. */
export type CommentTargetKind = (typeof rawCommentTargetEnum)[number];

/** What a thing comments can hang off must be able to answer. */
export interface CommentTarget {
  kind: CommentTargetKind;
  /** The project whose members may read and write it; null when it is gone. */
  projectIdFor(id: number): Promise<ProjectResolution>;
  /**
   * The entity an activity row for a comment on this target names. A track
   * audio is not something the feed can name, so it answers with its track.
   */
  activityTarget(
    id: number
  ): Promise<{ entityType: EntityKind; entityId: number } | null>;
  /**
   * Share-locks the row a comment is about to be written against, for the
   * rest of the writing transaction, answering false when it is gone. Set on
   * a target something deletes only once it has checked the target has no
   * comments: a comment names its target with no foreign key, so without the
   * lock one could land between that check and the delete and be left
   * pointing at nothing.
   */
  lockForComment?(tx: Tx, id: number): Promise<boolean>;
}

/** A join table linking assets to one entity kind. */
export type AttachmentJoin = {
  table: PgTable;
  entityColumn: PgColumn;
  assetColumn: PgColumn;
  /**
   * Links one asset to one row, answering with the new join row — or nothing
   * when the pair is already there. Only the join `POST /:id/attachments`
   * writes to needs it; a read-only source (a track's audio versions) does not.
   */
  link?(entityId: number, assetId: number): Promise<unknown | undefined>;
};

/** Every row an entity's CRUD surface hands back carries these. */
export type EntityRow = { id: number };

/**
 * The project-scoped listing of one entity kind: the paginated page, the
 * summary list and the bulk writes the table's select-all drives. Absent on
 * the project module, which is what those listings are scoped to.
 */
export interface EntityList {
  /** Query parameters the paginated route takes, on top of the shared ones. */
  querySchema: ZodType;
  /**
   * The column filters among those parameters, by name: what a table filters
   * on, as against the shared paging and sorting params or a scope such as
   * `archived`. `scripts/generate-api.ts` emits them into the API package as
   * `<KIND>_FILTER_PARAMS`.
   */
  filterParams: readonly string[];
  /** The sort whitelist's own keys, for the OpenAPI description and any other caller that enumerates them. */
  sortColumns: readonly string[];
  /**
   * The grouping whitelist's own keys, the same way {@link sortColumns} names
   * the sort ones. Empty for a listing that does not group. REST resolves an
   * unknown `groupBy` to no grouping, so a stale client URL never 400s; MCP
   * turns this into an enum instead, where a silent default reads as a broken
   * tool rather than a tolerated one.
   */
  groupColumns: readonly string[];
  rowSchema: ZodType;
  summarySchema: ZodType;
  /** What a bulk patch may set. */
  patchSchema: ZodType;
  page(projectId: number, query: unknown): Promise<Paginated<unknown>>;
  summaries(projectId: number): Promise<unknown[]>;
  bulkUpdate(
    projectId: number,
    selection: BulkSelection,
    patch: unknown,
    actorId: string
  ): Promise<{ updated: number }>;
  bulkDelete(projectId: number, selection: BulkSelection): Promise<number[]>;
  /** The ids a selection resolves to, ordered by id. Ids outside `projectId` are excluded silently. */
  selectIds(projectId: number, selection: BulkSelection): Promise<number[]>;
}

/**
 * Everything the rest of the server needs to know about one entity kind.
 * Consumers iterate the registry and call these; none of them names a kind.
 */
export interface EntityModule extends CommentTarget {
  kind: EntityKind;
  /** Where its router mounts, e.g. `/tracks`. */
  mountPath: `/${string}`;
  /** Singular display name, for error messages. */
  label: string;
  table: PgTable & { id: PgColumn };
  /**
   * The column naming the project a row belongs to. A project is its own
   * scope, so its module points this at the primary key.
   */
  projectColumn: PgColumn;
  /** The column holding the row's display name. */
  nameColumn: PgColumn;

  /**
   * The row field the block-document notes/description live on. Defaults to
   * `"notes"`; the project module is `"description"`, its own name for the
   * same jsonb shape.
   */
  notesField?: "notes" | "description";
  /**
   * Whether the MCP `create_<kind>` tool covers this entity. Defaults to
   * true; false for `session` (the scanner creates these) and `project`
   * (only `create_track` and `create_collection` ship as tools).
   */
  mcpCreate?: boolean;
  /**
   * The project role the MCP `delete_<kind>` tool (and, for `project`, the
   * `DELETE /projects/:id` policy) requires. Defaults to `"editor"`; the
   * project module raises it to `"owner"`, the same rank the REST route
   * requires, so both surfaces read one source.
   */
  deleteRole?: MemberRole;
  /**
   * Set on the two entities a caller can move through a status vocabulary
   * (`track`, `collection`). `set` writes the row's `statusId` and answers
   * the updated row, the way each entity's own `updateXStatus` query does.
   */
  status?: { set(id: number, statusId: number): Promise<EntityRow> };
  /**
   * Set on the entities whose rows hold a level of their project's priority
   * scale (`track`, `collection`, `session`). Their REST writes name the
   * level as `priorityId`; the MCP write tools take its name as `priority`.
   */
  priorityLevel?: boolean;
  /**
   * Set on the entity whose listing filters by a relation type (`track`). Its
   * REST listing names the type as `relation=<id>`; the MCP `list_<kind>s`
   * tool takes its name.
   */
  relationFilter?: boolean;
  /**
   * Set on the entities a caller can carry into another project. Moves the row
   * with everything that goes with it, checks the actor is an editor in the
   * target (the source is the caller's to gate), logs on both sides and
   * answers the moved row. Absent on `project`, which has nowhere to move to.
   */
  move?(id: number, projectId: number, actorId: string): Promise<EntityRow>;
  /**
   * Set on the entity a caller can archive (`track`). `set` archives or
   * unarchives the given rows, touching only those not already in the target
   * state, and answers the ids that changed with the number of sessions that
   * follow them. The bulk archive routes build on it.
   */
  archive?: {
    set(
      ids: number[],
      archived: boolean
    ): Promise<{ ids: number[]; sessionCount: number }>;
  };

  /**
   * Set when an image can be pinned to this entity as its cover. `set` writes
   * the image's own storage key onto the row (or clears it), answering false
   * when no such row exists.
   */
  image?: { set(id: number, assetPath: string | null): Promise<boolean> };
  /** Set when the entity carries the project's label vocabulary. */
  labels?: LabelTarget;
  /**
   * Set on the entities a project defines custom fields for. `defineEntity`
   * then gives the module's writes a `fields` bag keyed `cf_<id>`: `create`,
   * `update` and the listing's `bulkUpdate` write it, `assertWritable` checks
   * it against the project's fields, and `row`, `create` and `update` answer
   * with the entity's own bag, so a patch's activity diff covers its values.
   */
  customFields?: CustomFieldKind;
  /** The join `POST /:id/attachments` writes to. */
  attachments?: AttachmentJoin;
  /** Every join through which an asset reaches this entity. */
  assetSources: AttachmentJoin[];
  /**
   * The cover a comment search shows for this entity, as a SQL expression:
   * search resolves the whole chain inside one statement. Absent for the
   * project, whose comments have no parent row to surface as.
   */
  commentSearchImagePath?: SQL;
  /**
   * Columns this entity never records an activity diff for, on top of the
   * shared `updatedAt`/`createdAt`/`id`. For machine-written fields whose
   * changes are noise in a feed a person reads — a hash, a mtime, a path list
   * that already has a proper home elsewhere.
   */
  activityIgnoredFields?: readonly string[];

  /** Per-mount role policy, as `authorizeProject` takes it. */
  policy?: RolePolicy;
  /**
   * How a request on this mount resolves to a project, when reading the path
   * id or the body's `projectId` is not enough.
   */
  resolveRoute?: ProjectIdResolver;

  schemas: {
    row: ZodType;
    detail: ZodType;
    create: ZodType;
    edit: ZodType;
  };
  /**
   * Whether a delete leaves a feed for the entry to sit in. Deleting a project
   * takes its whole activity log with it, so nothing is recorded for one.
   */
  recordsDelete: boolean;

  /** The detail response, for a caller holding `role` in the row's project. */
  load(id: number, role: MemberRole): Promise<unknown>;
  /** The bare row, for diffing before an update. */
  row(id: number): Promise<EntityRow | undefined>;
  create(data: unknown, actor: { userId: string }): Promise<EntityRow>;
  update(id: number, patch: unknown): Promise<EntityRow>;
  remove(id: number): Promise<EntityRow>;
  /** The foreign ids a create or patch body names must sit in `projectId`. */
  assertWritable(body: unknown, projectId: number): Promise<void>;
  /** Every id must name a row of this entity inside `projectId`; else 404. */
  assertInProject(
    ids: readonly (number | null | undefined)[],
    projectId: number,
    what?: string
  ): Promise<void>;
  /** The project a row of this entity belongs to. */
  projectIdOfRow(row: EntityRow): number;

  list?: EntityList;
  /**
   * Fields an MCP `get_<entity>` tool merges onto `load`'s result, for data a
   * caller needs there but the HTTP detail response does not carry (or
   * carries in a heavier shape than an MCP caller wants).
   *
   * Without `replaces`, `schema` describes only the extra keys `read` adds,
   * and the tool's output is `module.schemas.detail.and(schema)`. With
   * `replaces`, those named keys are dropped from the loaded detail before
   * `read`'s result is merged in, and `schema` must describe the whole
   * merged output (not just the added keys) — a module sets `replaces` when
   * the HTTP shape of a field is too large or detailed for an MCP caller,
   * and `read` returns a slimmer replacement for it instead of adding an
   * `.and()`-able field alongside it.
   */
  mcpDetail?: {
    schema: ZodType;
    read(id: number): Promise<Record<string, unknown>>;
    /** Keys of `schemas.detail` that `read`'s result replaces outright. */
    replaces?: readonly string[];
    /**
     * Overrides `get_<kind>`'s default description, for a module whose
     * `mcpDetail` changes what the tool returns enough to need its own
     * wording.
     */
    description?: string;
  };
}
