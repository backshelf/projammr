import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";
import { db } from "../db/index.js";
import { recordActivityDiffs } from "../db/queries/activity.js";
import {
  assertScoped,
  type MemberRole,
  type ProjectResolution,
} from "../db/queries/authorization.js";
import {
  fieldBagOf,
  type FieldWriteBag,
  resolveFieldWrites,
  setValues,
} from "../db/queries/custom-fields.js";
import type { BulkSelection, Paginated } from "../db/queries/pagination.js";
import type { CustomFieldKind } from "../db/schema/custom-fields.js";
import type {
  AttachmentJoin,
  EntityKind,
  EntityList,
  EntityModule,
  EntityRow,
} from "./types.js";

/**
 * The implementations every entity module composes rather than writes: the
 * project resolver, the in-project assertion, the activity target and the
 * two type-erasing constructors the registry stores modules as.
 */

/** Reads the project a row belongs to. `null` when the row is not there. */
function scopedResolver(
  table: PgTable & { id: PgColumn },
  projectColumn: PgColumn
): (id: number) => Promise<ProjectResolution> {
  return async (id) => {
    if (!Number.isInteger(id)) return null;
    const [row] = await db
      .select({ projectId: projectColumn })
      .from(table)
      .where(eq(table.id, id));
    // `Number(null)` is `0`, a real project id — a row whose project column
    // itself reads null (never true for a registered entity today, but not
    // something to coerce away silently) must still answer "no project".
    if (!row || row.projectId == null) return null;
    return Number(row.projectId);
  };
}

/** Every id must name a row of `table` inside the project; 404 otherwise. */
function scopedAssert(
  table: PgTable & { id: PgColumn },
  projectColumn: PgColumn,
  label: string
): (
  ids: readonly (number | null | undefined)[],
  projectId: number,
  what?: string
) => Promise<void> {
  return (ids, projectId, what) =>
    assertScoped(table, table.id, projectColumn, ids, projectId, what ?? label);
}

/** An entity names itself in the activity feed. */
function selfActivityTarget(
  kind: EntityKind,
  projectIdFor: (id: number) => Promise<ProjectResolution>
): (
  id: number
) => Promise<{ entityType: EntityKind; entityId: number } | null> {
  return async (id) =>
    (await projectIdFor(id)) == null
      ? null
      : { entityType: kind, entityId: id };
}

/** A scoped row names the project it belongs to. */
export const projectIdOfScopedRow = (row: EntityRow): number =>
  (row as EntityRow & { projectId: number }).projectId;

/** A project is its own scope. */
export const projectIdOfSelf = (row: EntityRow): number => row.id;

/**
 * The API reference group an entity's routes are listed under — the ones
 * every entity shares and the ones only it has alike.
 */
export const entityTag = (m: Pick<EntityModule, "label">): string =>
  `${m.label}s`;

/**
 * The typed definition of one entity module. `defineEntity` erases the row,
 * create and patch types so the registry can hold four modules of different
 * shapes; every module is still written and checked against its own types.
 */
type EntitySpec<Row extends EntityRow, Create, Edit> = Omit<
  EntityModule,
  | "projectIdFor"
  | "activityTarget"
  | "assertInProject"
  | "assetSources"
  | "load"
  | "row"
  | "create"
  | "update"
  | "remove"
  | "assertWritable"
  | "projectIdOfRow"
  | "recordsDelete"
  | "schemas"
> & {
  /**
   * The create and edit schemas are tied to the types the module's own
   * functions take, so a body that parses is a body they accept.
   */
  schemas: {
    row: ZodType;
    detail: ZodType;
    create: ZodType<Create>;
    edit: ZodType<Edit>;
  };
  /** Defaults to true; only a project's own deletion goes unrecorded. */
  recordsDelete?: boolean;
  load(id: number, role: MemberRole): Promise<unknown>;
  row(id: number): Promise<Row | undefined>;
  create(data: Create, actor: { userId: string }): Promise<Row>;
  update(id: number, patch: Edit): Promise<Row>;
  remove(id: number): Promise<Row>;
  projectIdOfRow(row: Row): number;
  /** Defaults to no check, for an entity whose bodies name no foreign row. */
  assertWritable?(
    body: Partial<Create & Edit>,
    projectId: number
  ): Promise<void>;
  /** Defaults to the attachment join alone. */
  assetSources?: AttachmentJoin[];
};

/**
 * Builds a module from its typed definition. The casts are the one place the
 * server crosses from "this route validated its body against this module's
 * schema" to "the registry holds modules of every shape"; each is applied to a
 * value the module's own schema has already parsed.
 */
export function defineEntity<Row extends EntityRow, Create, Edit>(
  spec: EntitySpec<Row, Create, Edit>
): EntityModule {
  const projectIdFor = scopedResolver(spec.table, spec.projectColumn);

  const module: EntityModule = {
    ...spec,
    recordsDelete: spec.recordsDelete ?? true,
    projectIdFor,
    activityTarget: selfActivityTarget(spec.kind, projectIdFor),
    assertInProject: scopedAssert(spec.table, spec.projectColumn, spec.label),
    assetSources:
      spec.assetSources ?? (spec.attachments ? [spec.attachments] : []),
    load: spec.load,
    row: spec.row,
    create: (data, actor) => spec.create(data as Create, actor),
    update: (id, patch) => spec.update(id, patch as Edit),
    remove: spec.remove,
    projectIdOfRow: (row) => spec.projectIdOfRow(row as Row),
    assertWritable: async (body, projectId) => {
      await spec.assertWritable?.(body as Partial<Create & Edit>, projectId);
    },
  };
  return spec.customFields
    ? withCustomFields(module, spec.customFields)
    : module;
}

/** A write body's `fields` bag, and the body without it. */
function splitFieldWrites(body: unknown): {
  bag: FieldWriteBag | undefined;
  columns: Record<string, unknown>;
} {
  const { fields, ...columns } = (body ?? {}) as Record<string, unknown> & {
    fields?: FieldWriteBag;
  };
  return { bag: fields, columns };
}

/**
 * The module of a kind with custom fields: its writes take a `fields` bag,
 * which the module's own functions never see, and its rows answer with the
 * entity's bag. Every REST route and MCP tool that writes an entity goes
 * through these, so none of them handles the bag itself.
 */
function withCustomFields(
  module: EntityModule,
  kind: CustomFieldKind
): EntityModule {
  const withBag = async (row: EntityRow) => ({
    ...row,
    fields: await fieldBagOf(kind, row.id),
  });

  return {
    ...module,
    list: module.list && withFieldBulkWrites(module.list, kind),
    assertWritable: async (body, projectId) => {
      await module.assertWritable(body, projectId);
      await resolveFieldWrites(kind, projectId, splitFieldWrites(body).bag);
    },
    row: async (id) => {
      const row = await module.row(id);
      return row && withBag(row);
    },
    create: async (data, actor) => {
      const { bag, columns } = splitFieldWrites(data);
      const row = await module.create(columns, actor);
      if (bag) await setValues(kind, module.projectIdOfRow(row), [row.id], bag);
      return withBag(row);
    },
    update: async (id, patch) => {
      const { bag, columns } = splitFieldWrites(patch);
      // A patch of values alone writes no column of the row itself.
      const row =
        Object.keys(columns).length > 0
          ? await module.update(id, columns)
          : await module.row(id);
      if (!row) throw new HTTPException(404);
      if (bag) await setValues(kind, module.projectIdOfRow(row), [id], bag);
      return withBag(row);
    },
  };
}

/**
 * A listing whose bulk patch may carry a `fields` bag. The selection resolves
 * to ids once, before anything is written, so a column the patch changes
 * cannot move which rows the values land on. Each row's value changes are
 * recorded as its own `updated` activity, keyed `cf_<id>`.
 */
function withFieldBulkWrites(
  list: EntityList,
  kind: CustomFieldKind
): EntityList {
  return {
    ...list,
    bulkUpdate: async (projectId, selection, patch, actorId) => {
      const { bag, columns } = splitFieldWrites(patch);
      if (!bag || Object.keys(bag).length === 0) {
        return list.bulkUpdate(projectId, selection, columns, actorId);
      }

      const ids = await list.selectIds(projectId, selection);
      if (ids.length === 0) return { updated: 0 };
      if (Object.keys(columns).length > 0) {
        await list.bulkUpdate(projectId, { ids }, columns, actorId);
      }
      const changes = await setValues(kind, projectId, ids, bag);
      await recordActivityDiffs(
        [...changes].map(([entityId, { before, after }]) => ({
          projectId,
          entityType: kind,
          entityId,
          userId: actorId,
          before: { fields: before },
          after: { fields: after },
        }))
      );
      return { updated: ids.length };
    },
  };
}

/** The typed definition of an entity's project-scoped listing. */
type ListSpec<Query, Row, Summary, Patch> = {
  querySchema: EntityList["querySchema"];
  filterParams: EntityList["filterParams"];
  sortColumns: readonly string[];
  groupColumns: readonly string[];
  rowSchema: EntityList["rowSchema"];
  summarySchema: EntityList["summarySchema"];
  patchSchema: EntityList["patchSchema"];
  page(projectId: number, query: Query): Promise<Paginated<Row>>;
  summaries(projectId: number): Promise<Summary[]>;
  bulkUpdate(
    projectId: number,
    selection: BulkSelection,
    patch: Patch,
    actorId: string
  ): Promise<{ updated: number }>;
  bulkDelete(projectId: number, selection: BulkSelection): Promise<number[]>;
  selectIds(projectId: number, selection: BulkSelection): Promise<number[]>;
};

/** Erases a listing's query and patch types the same way `defineEntity` does. */
export function defineList<Query, Row, Summary, Patch>(
  spec: ListSpec<Query, Row, Summary, Patch>
): EntityList {
  return {
    ...spec,
    page: (projectId, query) => spec.page(projectId, query as Query),
    bulkUpdate: (projectId, selection, patch, actorId) =>
      spec.bulkUpdate(projectId, selection, patch as Patch, actorId),
  };
}
