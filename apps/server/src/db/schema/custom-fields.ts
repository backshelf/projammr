import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  type PgColumn,
  type PgTable,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { baseSchema, colourHexSchema } from "./base.js";
import { collections } from "./collections.js";
import { projects } from "./projects.js";
import { tracks } from "./tracks.js";

/**
 * The value types a custom field can hold. Stored as text rather than a
 * Postgres enum, the way `sessions.daw` is: the list is owned here, and a
 * field's type is fixed once it is created.
 */
const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "url",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);

/** The entities a project can define custom fields for. */
export const CUSTOM_FIELD_KINDS = ["track", "collection"] as const;

export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export const customFieldKindSchema = z.enum(CUSTOM_FIELD_KINDS);

/**
 * An option id rides in a query string's comma-separated membership list and
 * in a table column id, so it is a short token that holds none of `,` `.` `:`.
 */
export const selectOptionIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,32}$/,
    "An option id is 1-32 letters, digits, _ or -"
  );

/** One choice of a select field. Its `id` is what a value row stores. */
export const selectOptionSchema = z.object({
  id: selectOptionIdSchema,
  label: z.string().trim().min(1).max(255),
  colour: colourHexSchema.optional(),
});

export type SelectOption = z.infer<typeof selectOptionSchema>;

/**
 * A field a project defines on its tracks or its collections. `rank` orders a
 * kind's fields; `options` are a select field's choices and empty for every
 * other type. A name is unique within a project and kind.
 */
export const customFields = pgTable(
  "custom_fields",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("entity_kind").$type<CustomFieldKind>().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    type: text("type").$type<CustomFieldType>().notNull(),
    options: jsonb("options").$type<SelectOption[]>().notNull().default([]),
    rank: integer("rank").notNull(),
  },
  (t) => [
    uniqueIndex("custom_fields_project_kind_name").on(
      t.projectId,
      t.kind,
      t.name
    ),
  ]
);

export type CustomField = typeof customFields.$inferSelect;

export const customFieldSchema = createSelectSchema(customFields).extend({
  kind: customFieldKindSchema,
  type: customFieldTypeSchema,
  options: z.array(selectOptionSchema),
});

/**
 * One entity's value for one field. Exactly one of `trackId`/`collectionId`
 * names the entity, and exactly one typed column holds the value: the one the
 * field's type stores into. A field with no value on an entity has no row, so
 * "unset" is the absence of a row, never a null column. Both foreign keys and
 * the field cascade, so deleting a field, a track or a collection takes its
 * values with it.
 */
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    fieldId: integer("field_id")
      .references(() => customFields.id, { onDelete: "cascade" })
      .notNull(),
    trackId: integer("track_id").references(() => tracks.id, {
      onDelete: "cascade",
    }),
    collectionId: integer("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    textValue: text("text_value"),
    numberValue: numeric("number_value", { mode: "number" }),
    dateValue: date("date_value", { mode: "string" }),
    boolValue: boolean("bool_value"),
    optionValue: text("option_value"),
    urlValue: text("url_value"),
  },
  (t) => [
    check(
      "custom_field_values_one_entity",
      sql`num_nonnulls(${t.trackId}, ${t.collectionId}) = 1`
    ),
    check(
      "custom_field_values_one_value",
      sql`num_nonnulls(${t.textValue}, ${t.numberValue}, ${t.dateValue}, ${t.boolValue}, ${t.optionValue}, ${t.urlValue}) = 1`
    ),
    // Led by the entity, so they also serve reading an entity's values and
    // the cascade from a deleted track or collection.
    uniqueIndex("custom_field_values_track_field").on(t.trackId, t.fieldId),
    uniqueIndex("custom_field_values_collection_field").on(
      t.collectionId,
      t.fieldId
    ),
    // One per typed column, led by the field: what a sort, a filter or a facet
    // on one field reads.
    index("custom_field_values_field_text").on(t.fieldId, t.textValue),
    index("custom_field_values_field_number").on(t.fieldId, t.numberValue),
    index("custom_field_values_field_date").on(t.fieldId, t.dateValue),
    index("custom_field_values_field_bool").on(t.fieldId, t.boolValue),
    index("custom_field_values_field_option").on(t.fieldId, t.optionValue),
    index("custom_field_values_field_url").on(t.fieldId, t.urlValue),
  ]
);

/** How one kind's rows own their values. */
export type CustomFieldOwner = {
  /** The entity's table and its primary key. */
  table: PgTable;
  id: PgColumn;
  /** The value row's foreign key to the entity. */
  valueKey: "trackId" | "collectionId";
};

/**
 * Each kind's binding to the value table. Everything that reads or writes
 * values for a kind goes through this, so a kind gaining fields is an entry
 * here plus its foreign key above.
 */
export const CUSTOM_FIELD_OWNERS: Record<CustomFieldKind, CustomFieldOwner> = {
  track: { table: tracks, id: tracks.id, valueKey: "trackId" },
  collection: {
    table: collections,
    id: collections.id,
    valueKey: "collectionId",
  },
};
