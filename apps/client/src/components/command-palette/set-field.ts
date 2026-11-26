import { describeValue, fieldKind } from "@/fields";
import { customFieldKey, kindForField } from "@/fields/custom-field";
import type { FieldConfig, FieldKindName, FieldValue } from "@/fields/types";
import type { CustomField } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";

/*
 * The palette's `set <field> <value>`: the field is named as the user reads it
 * and the value is typed as its kind parses it, so `set energy 7` writes the
 * number 7 to the page's Energy field and `set mood dark` writes the option id
 * of the one labelled Dark.
 */

/** A field `set` can write, with the kind that parses a value for it. */
export type SettableField = {
  /** What a save names: a column, or a custom field's `cf_<id>`. */
  key: string;
  name: string;
  config: { type: FieldKindName } & FieldConfig;
  builtIn: boolean;
};

/** One way to finish the command: the field, the parsed value, and how it reads. */
export type SetFieldChoice = { key: string; value: FieldValue; title: string };

/**
 * The built-in field a `set` reaches on a track or a collection: its title,
 * which wins over a custom field of the same name.
 */
const TITLE: SettableField = {
  key: "title",
  name: "Title",
  config: { type: "text", required: true },
  builtIn: true,
};

/** The fields `set` reaches on an entity whose project defines `fields`. */
export function settableFields(
  fields: readonly CustomField[]
): SettableField[] {
  return [
    TITLE,
    ...fields.map((field) => ({
      key: customFieldKey(field),
      name: field.name,
      config: kindForField(field),
      builtIn: false,
    })),
  ];
}

/**
 * The field the start of `remainder` names and the text after it. A name in
 * quotes is a custom field's, whole and exactly (any case), which is how a
 * custom field that shares a built-in's name is reached. Otherwise the longest
 * name followed by a space or the end matches, a built-in before any custom
 * field.
 */
function splitField(
  remainder: string,
  fields: readonly SettableField[]
): { field: SettableField; rest: string } | null {
  const text = remainder.trimStart();
  const quoted = /^"([^"]+)"\s*(.*)$/s.exec(text);
  if (quoted) {
    const name = quoted[1]!.toLowerCase();
    const field = fields.find(
      (f) => !f.builtIn && f.name.toLowerCase() === name
    );
    return field ? { field, rest: quoted[2]! } : null;
  }
  const lower = text.toLowerCase();
  const matches = fields.filter((field) => {
    const name = field.name.toLowerCase();
    return lower === name || lower.startsWith(`${name} `);
  });
  const best =
    matches.find((field) => field.builtIn) ??
    matches.sort((a, b) => b.name.length - a.name.length)[0];
  return best ? { field: best, rest: text.slice(best.name.length) } : null;
}

const choice = (
  field: SettableField,
  value: FieldValue,
  formatters: Formatters
): SetFieldChoice => ({
  key: field.key,
  value,
  title: `Set ${field.name} to ${describeValue(field.config, value, formatters)}`,
});

/**
 * The ways `remainder` can finish: none until it names a field; then, for a
 * field with a fixed set of values (a select's options, a box's two states),
 * each one the typed text matches, and for any other the value the text
 * parses to, or none when it does not parse.
 */
export function resolveSetField(
  remainder: string,
  fields: readonly SettableField[],
  formatters: Formatters
): SetFieldChoice[] {
  const split = splitField(remainder, fields);
  if (!split) return [];
  const { field } = split;
  const typed = split.rest.trim();
  const { options, type } = field.config;

  if (options) {
    const wanted = typed.toLowerCase();
    return options
      .filter((option) => option.label.toLowerCase().includes(wanted))
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase() === wanted) -
          Number(a.label.toLowerCase() === wanted)
      )
      .map((option) => choice(field, option.value, formatters));
  }
  if (type === "checkbox" && typed === "") {
    return [choice(field, true, formatters), choice(field, false, formatters)];
  }
  if (typed === "") return [];
  const parsed = fieldKind(type).parse(typed, field.config);
  return parsed.ok && parsed.value !== null
    ? [choice(field, parsed.value, formatters)]
    : [];
}
