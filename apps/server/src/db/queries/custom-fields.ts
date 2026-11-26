import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { ApiError } from "../../lib/http.js";
import { db, type Tx } from "../index.js";
import {
  CUSTOM_FIELD_OWNERS,
  type CustomField,
  type CustomFieldKind,
  customFieldKindSchema,
  customFields,
  customFieldSchema,
  customFieldTypeSchema,
  customFieldValues,
  type SelectOption,
  selectOptionIdSchema,
  selectOptionSchema,
} from "../schema/custom-fields.js";
import { isUniqueViolation } from "../unique-violation.js";
import {
  fieldType,
  type FieldValue,
  type ValueRows,
} from "./custom-field-types.js";
import type { Facets, GroupKey, TableJoin } from "./pagination.js";

/*
 * Custom fields: a project's own typed fields on its tracks and collections.
 * The definitions and their CRUD, the values an entity carries (read as a
 * `fields` bag, written through one path that types every value by its
 * field), and the listing plumbing that lets a `cf_<id>` key sort, filter,
 * group and facet a paginated list the way a built-in column does.
 */

/**
 * `cf_<id>`: how a custom field is named in a query string, a sort, a group,
 * a facet and a `fields` bag. It holds none of `.` `:` `,`, which the client
 * splits column ids on.
 */
const FIELD_KEY = /^cf_[1-9]\d*$/;

const fieldKeySchema = z.string().regex(FIELD_KEY);

export const fieldKey = (id: number): string => `cf_${id}`;

/** Whether `key` names a custom field at all, known to the project or not. */
const isFieldKey = (key: string): boolean => FIELD_KEY.test(key);

export const fieldValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** An entity's custom values, keyed `cf_<id>`. A field with no value is absent. */
const fieldBagSchema = z
  .record(fieldKeySchema, fieldValueSchema)
  .describe(
    "Custom field values keyed `cf_<fieldId>`: text, url, date (YYYY-MM-DD) " +
      "and select (the option id) as strings, number as a number, checkbox " +
      "as a boolean. A field with no value is absent."
  );

/** Custom values to write, keyed `cf_<id>`; `null` clears one. */
const fieldWriteBagSchema = z
  .record(fieldKeySchema, fieldValueSchema.nullable())
  .describe(
    "Custom field values to write, keyed `cf_<fieldId>` and typed by the " +
      "field (a select takes an option id or its exact label). `null` clears " +
      "a value. A key naming no field of the entity's project, or a value " +
      "that does not fit its field, is a 400 naming the field."
  );

export type FieldBag = Record<string, FieldValue>;
export type FieldWriteBag = Record<string, FieldValue | null>;

/** A list row or detail body that carries the entity's custom values. */
export function withFieldValues<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>
) {
  return schema.extend({ fields: fieldBagSchema });
}

/** A create, patch or bulk-patch body that may also write custom values. */
export function withFieldWrites<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>
) {
  return schema.extend({ fields: fieldWriteBagSchema.optional() });
}

type Executor = typeof db | Tx;

/* Definitions. */

/** A field as a project's field list shows it: with how many values it holds. */
export const listedCustomFieldSchema = customFieldSchema.extend({
  valueCount: z
    .number()
    .int()
    .describe("How many entities hold a value; what deleting it loses"),
  optionCounts: z
    .record(z.string(), z.number().int())
    .optional()
    .describe(
      "A select field's entities per option id, what removing an option " +
        "leaves showing its id. An option no entity holds is absent, so read " +
        "it as 0. Absent on every other type."
    ),
});

export type ListedCustomField = z.infer<typeof listedCustomFieldSchema>;

export const customFieldsQuerySchema = z.object({
  kind: customFieldKindSchema.optional(),
});

/** An option as a write names it: an existing one keeps its `id`, a new one has none. */
const optionInputSchema = selectOptionSchema.extend({
  id: selectOptionIdSchema.optional(),
});

const fieldNameSchema = z.string().trim().min(1).max(255);

export const newCustomFieldSchema = z.object({
  kind: customFieldKindSchema,
  name: fieldNameSchema,
  type: customFieldTypeSchema,
  options: z.array(optionInputSchema).optional(),
});

/**
 * A field's name and a select's options can change; its type and kind cannot,
 * and naming either is a 400 rather than a silently ignored key.
 */
export const editCustomFieldSchema = z
  .strictObject({
    name: fieldNameSchema.optional(),
    options: z.array(optionInputSchema).optional(),
  })
  .refine((edit) => edit.name !== undefined || edit.options !== undefined, {
    message: "Provide a name or options",
  });

export const reorderCustomFieldsSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .describe("Every field of one kind, in the order they should show"),
});

/** A project's field definitions, a kind's in rank order. */
export async function getCustomFields(
  projectId: number,
  kind?: CustomFieldKind,
  executor: Executor = db
): Promise<CustomField[]> {
  return executor
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.projectId, projectId),
        kind ? eq(customFields.kind, kind) : undefined
      )
    )
    .orderBy(
      asc(customFields.kind),
      asc(customFields.rank),
      asc(customFields.id)
    );
}

async function withValueCounts(
  fields: CustomField[]
): Promise<ListedCustomField[]> {
  if (fields.length === 0) return [];
  const rows = await db
    .select({
      fieldId: customFieldValues.fieldId,
      option: customFieldValues.optionValue,
      n: count(),
    })
    .from(customFieldValues)
    .where(
      inArray(
        customFieldValues.fieldId,
        fields.map((field) => field.id)
      )
    )
    .groupBy(customFieldValues.fieldId, customFieldValues.optionValue);
  const totals = new Map<number, number>();
  const options = new Map<number, Record<string, number>>();
  for (const { fieldId, option, n } of rows) {
    totals.set(fieldId, (totals.get(fieldId) ?? 0) + n);
    if (option === null) continue;
    options.set(fieldId, { ...options.get(fieldId), [option]: n });
  }
  return fields.map((field) => ({
    ...field,
    valueCount: totals.get(field.id) ?? 0,
    ...(fieldType(field).hasOptions
      ? { optionCounts: options.get(field.id) ?? {} }
      : {}),
  }));
}

/** The project's fields of `kind` (or of every kind), each with its value count. */
export async function listCustomFields(
  projectId: number,
  kind?: CustomFieldKind
): Promise<ListedCustomField[]> {
  return withValueCounts(await getCustomFields(projectId, kind));
}

async function fieldInProject(
  projectId: number,
  fieldId: number
): Promise<CustomField> {
  const [field] = await db
    .select()
    .from(customFields)
    .where(
      and(eq(customFields.projectId, projectId), eq(customFields.id, fieldId))
    );
  if (!field) throw new HTTPException(404, { message: "Field not found" });
  return field;
}

/**
 * A select's options as written: an option naming an `id` keeps it and must
 * be one the field already has, a new one is given an id, and two options may
 * not share an id or a label (a move maps options by label).
 */
function normaliseOptions(
  inputs: z.infer<typeof optionInputSchema>[],
  existing: SelectOption[]
): SelectOption[] {
  const known = new Set(existing.map((option) => option.id));
  const ids = new Set<string>();
  const labels = new Set<string>();
  const fresh = () => {
    let id = randomUUID().slice(0, 8);
    while (known.has(id) || ids.has(id)) id = randomUUID().slice(0, 8);
    return id;
  };

  return inputs.map((input) => {
    if (input.id !== undefined && !known.has(input.id)) {
      throw new HTTPException(400, {
        message: `The field has no option ${input.id}`,
      });
    }
    const id = input.id ?? fresh();
    if (ids.has(id)) {
      throw new HTTPException(400, { message: `Option ${id} is listed twice` });
    }
    if (labels.has(input.label)) {
      throw new HTTPException(400, {
        message: `Two options are labelled "${input.label}"`,
      });
    }
    ids.add(id);
    labels.add(input.label);
    return {
      id,
      label: input.label,
      ...(input.colour ? { colour: input.colour } : {}),
    };
  });
}

function assertOptionsFit(
  field: Pick<CustomField, "type">,
  options: unknown[] | undefined
) {
  if (!fieldType(field).hasOptions && options && options.length > 0) {
    throw new HTTPException(400, {
      message: "Only a select field has options",
    });
  }
}

const nameTaken = () =>
  new HTTPException(409, {
    message: "A field with that name already exists",
  });

/** Creates a field after the kind's last one; a name the kind already has is a 409. */
export async function createCustomField(
  projectId: number,
  data: z.infer<typeof newCustomFieldSchema>
): Promise<ListedCustomField> {
  assertOptionsFit(data, data.options);
  const options = fieldType(data).hasOptions
    ? normaliseOptions(data.options ?? [], [])
    : [];

  const [row] = await db
    .insert(customFields)
    .values({
      projectId,
      kind: data.kind,
      name: data.name,
      type: data.type,
      options,
      rank: sql`(select coalesce(max(${customFields.rank}), -1) + 1 from ${customFields} where ${customFields.projectId} = ${projectId} and ${customFields.kind} = ${data.kind})`,
    })
    .onConflictDoNothing({
      target: [customFields.projectId, customFields.kind, customFields.name],
    })
    .returning();
  if (!row) throw nameTaken();
  return { ...row, valueCount: 0 };
}

/**
 * Renames a field and/or replaces a select's options. Values holding an option
 * the edit removes keep its id, which the field no longer lists.
 */
export async function updateCustomField(
  projectId: number,
  fieldId: number,
  edit: z.infer<typeof editCustomFieldSchema>
): Promise<ListedCustomField> {
  const field = await fieldInProject(projectId, fieldId);
  assertOptionsFit(field, edit.options);

  const set: Partial<typeof customFields.$inferInsert> = {};
  if (edit.name !== undefined) set.name = edit.name;
  if (edit.options !== undefined && fieldType(field).hasOptions) {
    set.options = normaliseOptions(edit.options, field.options);
  }
  if (Object.keys(set).length === 0) {
    const [listed] = await withValueCounts([field]);
    return listed!;
  }

  try {
    const [row] = await db
      .update(customFields)
      .set(set)
      .where(eq(customFields.id, field.id))
      .returning();
    const [listed] = await withValueCounts([row!]);
    return listed!;
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

/**
 * Orders one kind's fields as `ids` lists them. The list must name every field
 * of that kind, each once: a field created since the caller read the list
 * makes it a 400, not a silently half-applied order.
 */
export async function reorderCustomFields(
  projectId: number,
  ids: number[]
): Promise<ListedCustomField[]> {
  const fields = await getCustomFields(projectId);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const named = ids.map((id) => byId.get(id));
  if (named.some((field) => field === undefined)) {
    throw new HTTPException(404, { message: "Field not found" });
  }
  const kind = named[0]!.kind;
  const ofKind = fields.filter((field) => field.kind === kind);
  if (
    new Set(ids).size !== ids.length ||
    named.some((field) => field!.kind !== kind) ||
    ids.length !== ofKind.length
  ) {
    throw new HTTPException(400, {
      message: `List every ${kind} field exactly once`,
    });
  }

  await db.transaction(async (tx) => {
    for (const [rank, id] of ids.entries()) {
      await tx
        .update(customFields)
        .set({ rank })
        .where(eq(customFields.id, id));
    }
  });
  return listCustomFields(projectId, kind);
}

/** Deletes a field; its values go with it. */
export async function deleteCustomField(
  projectId: number,
  fieldId: number
): Promise<void> {
  const [row] = await db
    .delete(customFields)
    .where(
      and(eq(customFields.projectId, projectId), eq(customFields.id, fieldId))
    )
    .returning({ id: customFields.id });
  if (!row) throw new HTTPException(404, { message: "Field not found" });
}

/* Values. */

/** Ids per chunk for a statement binding `perId` parameters per id, plus `reserve`. */
const idsPerChunk = (perId: number, reserve = 0) =>
  Math.max(1, Math.floor((bindParamLimit() - reserve) / perId));

/** Every custom value the given entities hold, as a `fields` bag per id. */
export async function valuesFor(
  kind: CustomFieldKind,
  ids: readonly number[],
  executor: Executor = db
): Promise<Map<number, FieldBag>> {
  const bags = new Map<number, FieldBag>();
  if (ids.length === 0) return bags;
  const owned = customFieldValues[CUSTOM_FIELD_OWNERS[kind].valueKey];

  for (const batch of chunk([...new Set(ids)], idsPerChunk(1))) {
    const rows = await executor
      .select({
        entityId: owned,
        fieldId: customFieldValues.fieldId,
        type: customFields.type,
        textValue: customFieldValues.textValue,
        numberValue: customFieldValues.numberValue,
        dateValue: customFieldValues.dateValue,
        boolValue: customFieldValues.boolValue,
        optionValue: customFieldValues.optionValue,
        urlValue: customFieldValues.urlValue,
      })
      .from(customFieldValues)
      .innerJoin(customFields, eq(customFields.id, customFieldValues.fieldId))
      .where(inArray(owned, batch))
      .orderBy(asc(customFields.rank), asc(customFields.id));
    for (const row of rows) {
      if (row.entityId == null) continue;
      const unit = fieldType(row);
      const bag = bags.get(row.entityId) ?? {};
      bag[fieldKey(row.fieldId)] = unit.read(row[unit.column]);
      bags.set(row.entityId, bag);
    }
  }
  return bags;
}

/** One entity's custom values. */
export async function fieldBagOf(
  kind: CustomFieldKind,
  id: number
): Promise<FieldBag> {
  return (await valuesFor(kind, [id])).get(id) ?? {};
}

/** One key of a `fields` bag resolved against its field and typed by it. */
type FieldWrite = { key: string; field: CustomField; value: FieldValue | null };

/**
 * Resolves a `fields` bag against `kind`'s fields in `projectId` and types
 * every value by its field. A key naming no such field (another project's
 * included) or a value its type refuses is a 400 naming the field.
 */
export async function resolveFieldWrites(
  kind: CustomFieldKind,
  projectId: number,
  bag: FieldWriteBag | undefined,
  executor: Executor = db
): Promise<FieldWrite[]> {
  const entries = Object.entries(bag ?? {});
  if (entries.length === 0) return [];
  const fields = new Map(
    (await getCustomFields(projectId, kind, executor)).map((field) => [
      fieldKey(field.id),
      field,
    ])
  );

  return entries.map(([key, raw]) => {
    const field = fields.get(key);
    if (!field) {
      throw new ApiError(400, {
        code: "unknown_field",
        message: `The project has no ${kind} field ${key}`,
        details: { field: key },
      });
    }
    if (raw === null) return { key, field, value: null };
    const parsed = fieldType(field).parse(raw, field);
    if ("error" in parsed) {
      throw new ApiError(400, {
        code: "invalid_field_value",
        message: `Field "${field.name}" ${parsed.error}`,
        details: { field: key, name: field.name, type: field.type },
      });
    }
    return { key, field, value: parsed.value };
  });
}

/** What one entity's written keys held before a write, and hold after it. */
export type FieldChange = { before: FieldBag; after: FieldBag };

/**
 * Writes a `fields` bag onto every entity in `ids`, in one transaction: a
 * value is upserted into its field's typed column, a `null` deletes the value
 * row. Answers each entity's before and after for the keys written, which is
 * what its activity records.
 */
export async function setValues(
  kind: CustomFieldKind,
  projectId: number,
  ids: readonly number[],
  bag: FieldWriteBag
): Promise<Map<number, FieldChange>> {
  const changes = new Map<number, FieldChange>();
  // An upsert may not touch one row twice, so each entity is named once.
  const entities = [...new Set(ids)];
  if (entities.length === 0) return changes;

  const { valueKey } = CUSTOM_FIELD_OWNERS[kind];
  const owned = customFieldValues[valueKey];

  return db.transaction(async (tx) => {
    const writes = await resolveFieldWrites(kind, projectId, bag, tx);
    if (writes.length === 0) return changes;
    const current = await valuesFor(kind, entities, tx);

    for (const { field, value } of writes) {
      if (value === null) {
        for (const batch of chunk(entities, idsPerChunk(1, 1))) {
          await tx
            .delete(customFieldValues)
            .where(
              and(
                eq(customFieldValues.fieldId, field.id),
                inArray(owned, batch)
              )
            );
        }
        continue;
      }
      const column = fieldType(field).column;
      for (const batch of chunk(entities, idsPerChunk(3, 1))) {
        await tx
          .insert(customFieldValues)
          .values(
            batch.map(
              (id) =>
                ({
                  fieldId: field.id,
                  [valueKey]: id,
                  [column]: value,
                }) as typeof customFieldValues.$inferInsert
            )
          )
          .onConflictDoUpdate({
            target: [owned, customFieldValues.fieldId],
            set: { [column]: value },
          });
      }
    }

    for (const id of entities) {
      const held = current.get(id) ?? {};
      const before: FieldBag = {};
      const after: FieldBag = {};
      for (const { key, value } of writes) {
        if (held[key] !== undefined) before[key] = held[key];
        if (value !== null) after[key] = value;
      }
      changes.set(id, { before, after });
    }
    return changes;
  });
}

/* The listing plumbing. */

/**
 * What `cf_<id>` keys do to one paginated listing of a kind: the sort keys
 * they add, the order a sort by one reads, the filters the request's own
 * `cf_<id>` params apply, the grouping a select or checkbox field offers and
 * the facet counts of the select fields. Built per request from the project's
 * own fields, so a key naming another project's field (or a deleted one) is
 * ignored exactly like an unknown built-in key.
 */
export type FieldListing = {
  /** The `cf_<id>` keys a sort may name. */
  sortKeys: string[];
  /** The `cf_<id>` keys a grouping may name. */
  groupKeys: string[];
  /**
   * What a `cf_<id>` sort key orders by and the join that expression reads;
   * undefined for any other key. The page applies the join the way it
   * applies a built-in key's `sortJoins`, the grouped pages included.
   */
  sort(key: string): { order: SQL; joins: TableJoin[] } | undefined;
  /** Every active field filter, less `except`'s own. */
  where(except?: string): SQL | undefined;
  /** The grouping a `cf_<id>` key names, when that field's type groups. */
  group(key: string): GroupKey | undefined;
  /**
   * Row counts per option of every select field, keyed by `cf_<id>`. Each is
   * counted against `where` (the listing's built-in filters) and every other
   * field filter, excluding its own, the way the built-in facets are.
   */
  facets(where: SQL | undefined): Promise<Facets>;
};

/** A query value as a filter reads it; MCP may pass a number or a boolean. */
function queryValue(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return undefined;
}

/**
 * The listing of `kind` in `projectId` under the request's params (the
 * validated query, or an `all: true` selection's filters).
 */
export async function fieldListing(
  kind: CustomFieldKind,
  projectId: number,
  params: Readonly<Record<string, unknown>>
): Promise<FieldListing> {
  const fields = await getCustomFields(projectId, kind);
  const owner = CUSTOM_FIELD_OWNERS[kind];
  const owned = customFieldValues[owner.valueKey];
  const byKey = new Map(fields.map((field) => [fieldKey(field.id), field]));

  // The field's value row for the listing's current row.
  const valueRowOf = (field: CustomField) =>
    sql`${customFieldValues.fieldId} = ${field.id} and ${owned} = ${owner.id}`;
  // The same row, joined under its own alias for a sort or a grouping to read.
  const joinValueRow = (name: string, field: CustomField) => {
    const joined = alias(customFieldValues, name);
    const join: TableJoin = {
      table: joined,
      on: sql`${joined.fieldId} = ${field.id} and ${joined[owner.valueKey]} = ${owner.id}`,
    };
    return { joined, join };
  };
  const rowsOf = (field: CustomField): ValueRows => ({
    having: (predicate) =>
      sql`exists (select 1 from ${customFieldValues} where ${valueRowOf(field)}${
        predicate ? sql` and ${predicate}` : sql``
      })`,
    lacking: () =>
      sql`not exists (select 1 from ${customFieldValues} where ${valueRowOf(field)})`,
  });

  const filters = new Map<string, SQL>();
  for (const [key, raw] of Object.entries(params)) {
    const field = byKey.get(key);
    const value = queryValue(raw);
    if (!field || value === undefined) continue;
    const predicate = fieldType(field).filter(value, field, rowsOf(field));
    if (predicate) filters.set(key, predicate);
  }

  const where = (except?: string) =>
    and(
      ...[...filters]
        .filter(([key]) => key !== except)
        .map(([, predicate]) => predicate)
    );

  return {
    sortKeys: [...byKey.keys()],
    groupKeys: fields
      .filter((field) => fieldType(field).group)
      .map((field) => fieldKey(field.id)),

    sort(key) {
      const field = byKey.get(key);
      if (!field) return undefined;
      const unit = fieldType(field);
      // A join rather than a correlated subquery: one scan of the field's
      // value rows through its `(field_id, …)` index, hashed against the
      // page, where a subquery probes the value table once per row. The
      // `(entity, field)` unique index keeps it to one value row per entity.
      const { joined, join } = joinValueRow("cf_sort", field);
      return { order: unit.order(joined[unit.column], field), joins: [join] };
    },

    where,

    group(key) {
      const field = byKey.get(key);
      const grouping = field && fieldType(field).group;
      if (!field || !grouping) return undefined;
      const { joined, join } = joinValueRow("cf_group", field);
      const value = joined[fieldType(field).column];
      return {
        keyColumn: value,
        orderColumn: grouping.order(value, field),
        labelColumn: grouping.label(value, field),
        joins: [join],
        noneLabel: "Not set",
      };
    },

    async facets(builtIn) {
      const faceted = fields.filter((field) => fieldType(field).facets);
      const counted = await Promise.all(
        faceted.map(async (field) => {
          const key = fieldKey(field.id);
          const facet = alias(customFieldValues, "cf_facet");
          const value = facet[fieldType(field).column];
          const rows = await db
            .select({ key: value, value: count() })
            .from(facet)
            .innerJoin(owner.table, eq(facet[owner.valueKey], owner.id))
            .where(and(eq(facet.fieldId, field.id), builtIn, where(key)))
            .groupBy(value);
          const counts: Record<string, number> = {};
          for (const row of rows) {
            if (row.key != null) counts[String(row.key)] = row.value;
          }
          return [key, counts] as const;
        })
      );
      return Object.fromEntries(counted);
    },
  };
}

/**
 * The field filters among `params` (an `all: true` selection's), as one
 * predicate. Reads the project's fields only when a `cf_` key is present.
 */
export async function fieldFilterWhere(
  kind: CustomFieldKind,
  projectId: number,
  params: Readonly<Record<string, unknown>>
): Promise<SQL | undefined> {
  if (!Object.keys(params).some(isFieldKey)) return undefined;
  return (await fieldListing(kind, projectId, params)).where();
}
