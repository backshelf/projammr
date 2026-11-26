import type { SettingDefinition } from "@workspace/settings";
import type { z } from "zod";

type Issue = z.core.$ZodRawIssue;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The hub's wording for a value a setting's schema refuses, for the refusals
 * any schema can make. A message the schema declares itself wins over this
 * one (zod ranks a schema's own error above a parse's), and anything left
 * unmatched keeps zod's.
 */
function hubMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case "too_small": {
      const least = Number(issue.minimum);
      if (issue.origin === "string") {
        return least <= 1
          ? "Can't be empty"
          : `Use at least ${plural(least, "character", "characters")}`;
      }
      if (issue.origin === "array") {
        return `Needs at least ${plural(least, "entry", "entries")}`;
      }
      return `Use ${least} or more`;
    }
    case "too_big": {
      const most = Number(issue.maximum);
      if (issue.origin === "string") {
        return `Use at most ${plural(most, "character", "characters")}`;
      }
      if (issue.origin === "array") {
        return `Takes at most ${plural(most, "entry", "entries")}`;
      }
      return `Use ${most} or less`;
    }
    case "invalid_type":
      if (issue.expected === "int") return "Enter a whole number";
      return issue.expected === "number" ? "Enter a number" : undefined;
    case "invalid_value":
      return "Choose one of the options";
    case "invalid_format":
      return "That isn't in the format this setting takes";
    default:
      return undefined;
  }
}

/**
 * Checks a value against a setting's schema before it is sent, so a control
 * can hold what the reader is still typing without a doomed request. The
 * server checks again; this only spares the round trip.
 */
export function checkValue(
  definition: SettingDefinition,
  value: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  const parsed = definition.schema.safeParse(value, { error: hubMessage });
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues[0]?.message ?? "That value can't be saved",
  };
}
