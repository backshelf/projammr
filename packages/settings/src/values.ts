import { z } from "zod";
import type { SettingDefinition } from "./types.js";

/** The shape `valuesSchema` builds: each key's schema, nullable and optional. */
export type ValuesShape<D extends SettingDefinition> = {
  [X in D as X["key"]]: z.ZodOptional<z.ZodNullable<X["schema"]>>;
};

/**
 * A patch of values for `definitions`: strict, so a key outside them is
 * rejected, and every member nullable and optional, so a patch names only the
 * keys it changes and `null` clears one. Typed per key when the definitions'
 * keys are known.
 */
export function valuesSchema<const D extends readonly SettingDefinition[]>(
  definitions: D
) {
  return z.strictObject(
    Object.fromEntries(
      definitions.map((definition) => [
        definition.key,
        definition.schema.nullable().optional(),
      ])
    ) as ValuesShape<D[number]>
  );
}
