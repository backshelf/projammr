import type { FieldConfig, FieldKind, ParseResult } from "@/fields/types";

/**
 * A `parse` for a kind whose raw text is one trimmed token: blank is `null`
 * (or "Required" when the field is), anything else goes to `convert` along with
 * the field's config.
 */
export function parseTrimmed(
  convert: (trimmed: string, config: FieldConfig) => ParseResult
): FieldKind["parse"] {
  return (raw, config) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return config.required
        ? { ok: false, error: "Required" }
        : { ok: true, value: null };
    }
    return convert(trimmed, config);
  };
}

/** A `format` for a kind whose value is one string or number. */
export const formatScalar: FieldKind["format"] = (value) =>
  value === null ? "" : String(value);

/**
 * The option a picker's editor opens on for the `seed` that opened it: the one
 * whose label is the seed, else the first whose label starts with it, compared
 * case-insensitively. Nothing matches a missing or empty seed.
 */
export function matchSeed<T>(
  seed: string | undefined,
  options: readonly T[],
  label: (option: T) => string
): T | undefined {
  if (!seed) return undefined;
  const wanted = seed.toLowerCase();
  const lower = (option: T) => label(option).toLowerCase();
  return (
    options.find((option) => lower(option) === wanted) ??
    options.find((option) => lower(option).startsWith(wanted))
  );
}
