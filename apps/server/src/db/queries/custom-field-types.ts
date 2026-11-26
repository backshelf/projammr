import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  type CustomField,
  type CustomFieldType,
  customFieldValues,
} from "../schema/custom-fields.js";
import { escapeLikeTerm } from "./pagination.js";

/**
 * What each custom field type knows about itself: the value-row column it
 * stores into, how a written value is checked and coerced, how the stored
 * value reads back, how a `cf_<id>` query value filters, what a sort orders by
 * and, for the types that group, a grouping's order and headers. The listing,
 * the writes and the moves call these; none of them branches on a type.
 */

/** A value as the API carries it in a `fields` bag. */
export type FieldValue = string | number | boolean;

/** The part of a field its type reads. */
type FieldDef = Pick<CustomField, "id" | "name" | "type" | "options">;

/** The value-row columns a type can store into. */
type ValueColumnKey =
  | "textValue"
  | "numberValue"
  | "dateValue"
  | "boolValue"
  | "optionValue"
  | "urlValue";

/**
 * The value rows a filter tests, bound to one field and to the rows of the
 * listing being filtered.
 */
export type ValueRows = {
  /** Rows holding a value of the field, narrowed by `predicate` when given. */
  having(predicate?: SQL): SQL;
  /** Rows with no value for the field. */
  lacking(): SQL;
};

/**
 * A written value checked against its type: the value the column stores,
 * `null` when the write clears the field, or why it does not fit.
 */
type ParsedValue = { value: FieldValue | null } | { error: string };

export interface FieldTypeUnit {
  /** The value-row column this type stores into. */
  column: ValueColumnKey;
  /** A written value checked and coerced for the column. */
  parse(value: FieldValue, field: FieldDef): ParsedValue;
  /** A stored column value as the API carries it. */
  read(stored: unknown): FieldValue;
  /**
   * The rows an encoded `cf_<id>` query value admits. `undefined` when the
   * value selects nothing to filter on (an empty range, an unknown state), so
   * the listing is left unfiltered, as an unknown key is.
   */
  filter(raw: string, field: FieldDef, rows: ValueRows): SQL | undefined;
  /** What a sort on the field orders by, given the expression of its value. */
  order(value: SQLWrapper, field: FieldDef): SQL;
  /**
   * A grouping's section order and header text over the joined value column.
   * Both are functions of that column alone, which is what lets a grouped
   * summary select, group and order by them. Absent when the type does not
   * group.
   */
  group?: {
    order(value: SQLWrapper, field: FieldDef): SQL;
    label(value: SQLWrapper, field: FieldDef): SQL;
  };
  /** Whether a listing counts its rows per value, for a filter menu. */
  facets: boolean;
  /** Whether a field of the type defines its own options to choose from. */
  hasOptions: boolean;
  /**
   * The stored value a row of `from` carries onto `to`, a field of the same
   * name and type in the project the row moves to, as an expression over the
   * row's value; null where `to` cannot hold it.
   */
  carry(value: SQLWrapper, from: FieldDef, to: FieldDef): SQL;
}

/**
 * Text and url values are indexed with their field, and a btree entry has a
 * size ceiling well under a page, so a value is capped in bytes.
 */
const MAX_TEXT_BYTES = 2000;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A number written as a JSON number or as its decimal text. */
function parseNumber(raw: FieldValue): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || !NUMBER.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** A calendar day written `YYYY-MM-DD` that exists. */
function parseDate(raw: FieldValue): string | undefined {
  if (typeof raw !== "string") return undefined;
  const day = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const [year, month, date] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
    ? day
    : undefined;
}

/** Trimmed text within the byte cap; an empty string clears the field. */
function parseBoundedText(raw: FieldValue): ParsedValue {
  if (typeof raw !== "string") return { error: "expects text" };
  const text = raw.trim();
  if (text === "") return { value: null };
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) {
    return { error: `is longer than ${MAX_TEXT_BYTES} bytes` };
  }
  return { value: text };
}

/**
 * `<from>..<to>` with either end left empty for an open range. Both ends empty,
 * no `..`, or an end that does not parse is no filter at all. `from` above
 * `to` is a real, empty range.
 */
function rangeFilter<T extends number | string>(
  raw: string,
  parse: (end: string) => T | undefined,
  column: PgColumn,
  rows: ValueRows
): SQL | undefined {
  const split = raw.indexOf("..");
  if (split < 0) return undefined;
  const ends = [raw.slice(0, split).trim(), raw.slice(split + 2).trim()];
  if (ends.every((end) => end === "")) return undefined;
  const [from, to] = ends.map((end) => (end === "" ? null : parse(end)));
  if (from === undefined || to === undefined) return undefined;
  return rows.having(
    and(
      from === null ? undefined : gte(column, from),
      to === null ? undefined : lte(column, to)
    )
  );
}

const valueColumn = (key: ValueColumnKey) => customFieldValues[key];

/** A value that means the same in any project's field of its type. */
const carryAsIs = (value: SQLWrapper) => sql`${value}`;

/**
 * The types whose value is its own order, has no grouping or facets, and
 * carries across projects unchanged.
 */
const plain = {
  order: (value: SQLWrapper) => sql`${value}`,
  facets: false,
  hasOptions: false,
  carry: carryAsIs,
} as const;

const text: FieldTypeUnit = {
  ...plain,
  column: "textValue",
  parse: parseBoundedText,
  read: (stored) => String(stored),
  // Contains, case-insensitively: the literal is matched anywhere in the value.
  filter: (raw, _field, rows) => {
    const term = raw.trim();
    if (term === "") return undefined;
    return rows.having(
      ilike(valueColumn("textValue"), `%${escapeLikeTerm(term)}%`)
    );
  },
};

const number: FieldTypeUnit = {
  ...plain,
  column: "numberValue",
  parse: (raw) => {
    const n = parseNumber(raw);
    return n === undefined ? { error: "expects a number" } : { value: n };
  },
  read: (stored) => Number(stored),
  filter: (raw, _field, rows) =>
    rangeFilter(raw, parseNumber, valueColumn("numberValue"), rows),
};

const date: FieldTypeUnit = {
  ...plain,
  column: "dateValue",
  parse: (raw) => {
    const day = parseDate(raw);
    return day === undefined
      ? { error: "expects a date as YYYY-MM-DD" }
      : { value: day };
  },
  read: (stored) => String(stored),
  filter: (raw, _field, rows) =>
    rangeFilter(raw, parseDate, valueColumn("dateValue"), rows),
};

/**
 * Three states: `true`, `false`, and unset, which is the absence of a value
 * row. A filter names any one of them.
 */
const checkbox: FieldTypeUnit = {
  column: "boolValue",
  parse: (raw) => {
    if (typeof raw === "boolean") return { value: raw };
    if (raw === "true" || raw === "false") return { value: raw === "true" };
    return { error: "expects true or false" };
  },
  read: (stored) => stored === true,
  filter: (raw, _field, rows) => {
    const state = raw.trim();
    if (state === "true" || state === "false") {
      return rows.having(eq(valueColumn("boolValue"), state === "true"));
    }
    return state === "unset" ? rows.lacking() : undefined;
  },
  order: (value) => sql`${value}`,
  group: {
    // Checked first, then unchecked; unset rows fall in the none bucket.
    order: (value) => sql`(not ${value})`,
    label: (value) =>
      sql`(case when ${value} then 'Yes' when not ${value} then 'No' end)`,
  },
  facets: false,
  hasOptions: false,
  carry: carryAsIs,
};

/**
 * The option's position in the field's list, or null for a value naming an
 * option the field no longer has.
 */
function optionPosition(value: SQLWrapper, field: FieldDef): SQL {
  if (field.options.length === 0) return sql`null::int`;
  const cases = field.options.map(
    (option, index) => sql`when ${option.id} then ${index}::int`
  );
  return sql`(case ${value} ${sql.join(cases, sql` `)} end)`;
}

/**
 * A select value names one of the field's options by id. A write may name the
 * option by id or by its exact label; the id is what is stored.
 */
const select: FieldTypeUnit = {
  column: "optionValue",
  parse: (raw, field) => {
    const option =
      field.options.find((o) => o.id === raw) ??
      field.options.find((o) => o.label === raw);
    return option
      ? { value: option.id }
      : { error: "expects one of its options" };
  },
  read: (stored) => String(stored),
  // Membership, comma-separated like the label filter. An id the field no
  // longer has matches nothing.
  filter: (raw, field, rows) => {
    const requested = raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (requested.length === 0) return undefined;
    const known = requested.filter((id) =>
      field.options.some((option) => option.id === id)
    );
    if (known.length === 0) return sql`false`;
    return rows.having(inArray(valueColumn("optionValue"), known));
  },
  // The field's own option order, not the ids' spelling.
  order: optionPosition,
  group: {
    order: optionPosition,
    // A value whose option was removed is headed by its raw id.
    label: (value, field) => {
      if (field.options.length === 0) return sql`${value}`;
      const cases = field.options.map(
        (option) => sql`when ${option.id} then ${option.label}::text`
      );
      return sql`coalesce(case ${value} ${sql.join(cases, sql` `)} end, ${value})`;
    },
  },
  facets: true,
  hasOptions: true,
  // Option ids belong to their field, so a value carries by its option's
  // label onto the other field's option of that label, or not at all.
  carry: (value, from, to) => {
    const cases = from.options.flatMap((option) => {
      const target = to.options.find((o) => o.label === option.label);
      return target ? [sql`when ${option.id} then ${target.id}`] : [];
    });
    if (cases.length === 0) return sql`null::text`;
    return sql`(case ${value} ${sql.join(cases, sql` `)} end)`;
  },
};

/**
 * An absolute http or https URL: clients put it in an `href`, where another
 * scheme (`javascript:`, `data:`) is not a link. A filter asks only whether one
 * is set.
 */
const url: FieldTypeUnit = {
  ...plain,
  column: "urlValue",
  parse: (raw) => {
    const parsed = parseBoundedText(raw);
    if ("error" in parsed || parsed.value === null) return parsed;
    const value = String(parsed.value);
    return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol)
      ? parsed
      : { error: "expects an absolute http or https URL" };
  },
  read: (stored) => String(stored),
  filter: (raw, _field, rows) => {
    const state = raw.trim();
    if (state === "set") return rows.having();
    return state === "unset" ? rows.lacking() : undefined;
  },
};

const FIELD_TYPES: Record<CustomFieldType, FieldTypeUnit> = {
  text,
  number,
  date,
  checkbox,
  select,
  url,
};

/** The unit that knows `field`'s type. */
export const fieldType = (field: Pick<CustomField, "type">): FieldTypeUnit =>
  FIELD_TYPES[field.type];
