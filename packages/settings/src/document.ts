import { SETTINGS } from "./registry.js";
import type { SettingDefinition } from "./types.js";

/** Where a `document` entry mirrors its value onto `<html>`. */
type DocumentTarget = "attribute" | "property";

/**
 * The `<html>` names of one target the effective values ask for, one per
 * definition whose `document` entry names that target; a value that maps to
 * `null` is left off. A key missing from `effective`, or holding a value its
 * schema rejects, maps from its default, so the page renders from the
 * registry alone when no values have arrived.
 */
function mirrored(
  target: DocumentTarget,
  effective: Readonly<Record<string, unknown>>,
  definitions: readonly SettingDefinition[]
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const definition of definitions) {
    const { document } = definition;
    const name = (document as Partial<Record<DocumentTarget, string>>)?.[
      target
    ];
    if (document === undefined || name === undefined) continue;
    const parsed = definition.schema.safeParse(effective[definition.key]);
    const value = document.value(
      parsed.success ? parsed.data : definition.default
    );
    if (value !== null) names[name] = value;
  }
  return names;
}

/** The `<html>` attributes the effective values ask for. */
export const documentAttributes = (
  effective: Readonly<Record<string, unknown>>,
  definitions: readonly SettingDefinition[] = Object.values(SETTINGS)
) => mirrored("attribute", effective, definitions);

/** The CSS custom properties `<html>`'s inline style carries for the effective values. */
export const documentProperties = (
  effective: Readonly<Record<string, unknown>>,
  definitions: readonly SettingDefinition[] = Object.values(SETTINGS)
) => mirrored("property", effective, definitions);
