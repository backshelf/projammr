import { z } from "zod";
import type { SettingDefinition, SettingGroup, SettingScope } from "./types.js";

/** A scope's place in every cascade, highest first. */
const SCOPE_RANK: Record<SettingScope, number> = {
  user: 0,
  project: 1,
  instance: 2,
};

/** Declares a group; throws on an id that could not be a key's first segment. */
export function defineGroup(group: SettingGroup): SettingGroup {
  if (group.id === "" || group.id.includes(".")) {
    throw new Error(
      `Setting group "${group.id}": an id is non-empty and has no dot, since it is the first segment of its keys`
    );
  }
  return Object.freeze(group);
}

/**
 * Declares a setting, checking what one definition can check on its own: the
 * key's first segment is its group, `scopes` is non-empty and runs highest
 * first, and `default` parses `schema`. The registry checks the rest once
 * every group is loaded.
 *
 * The value type comes from the schema alone, so an enum keeps its members
 * rather than widening to `string` against a literal default.
 */
export function defineSetting<
  S extends z.ZodType,
  const K extends `${string}.${string}`,
>(
  definition: SettingDefinition<z.output<S>, K> & { readonly schema: S }
): SettingDefinition<z.output<S>, K> {
  const { key, group, scopes, schema } = definition;
  const fail = (problem: string): never => {
    throw new Error(`Setting "${key}": ${problem}`);
  };

  if (!key.startsWith(`${group}.`) || key.length === group.length + 1) {
    fail(
      `a key is its group's id, a dot and a name, and its group is "${group}"`
    );
  }
  if (scopes.length === 0) fail("scopes is empty");
  scopes.forEach((scope, index) => {
    const above = scopes[index - 1];
    if (above !== undefined && SCOPE_RANK[above] >= SCOPE_RANK[scope]) {
      fail(
        `scopes run highest first (user, project, instance) with no repeats; got ${scopes.join(" > ")}`
      );
    }
  });
  const parsed = schema.safeParse(definition.default);
  if (!parsed.success) {
    fail(
      `the default does not parse its schema: ${z.prettifyError(parsed.error)}`
    );
  }

  return Object.freeze(definition);
}

/**
 * The scopes of a key only the instance holds, spread into its definition. A
 * lock pins the scopes above the one holding it, and such a key has none, so
 * it is not lockable.
 */
export const INSTANCE_ONLY = {
  scopes: ["instance"],
  lockable: false,
} as const satisfies Pick<SettingDefinition, "scopes" | "lockable">;

/** The schema of a count or a length of time: a whole number from `min` to `max`. */
export const wholeNumber = (min: number, max: number) =>
  z.number().int().min(min).max(max);

/** What one file under `groups/` exports: its group and the settings in it. */
export interface GroupModule {
  readonly group: SettingGroup;
  readonly settings: readonly SettingDefinition[];
}

/**
 * Builds the registry from every group module, checking what spans them: each
 * group id is declared once, each file holds only its own group's settings,
 * each key and each document attribute is declared once. Groups come out in
 * `order` (ties by id), settings grouped by group in declaration order.
 */
export function buildRegistry(modules: Readonly<Record<string, GroupModule>>): {
  groups: readonly SettingGroup[];
  settings: Readonly<Record<string, SettingDefinition>>;
} {
  const sorted = Object.values(modules).sort(
    (a, b) =>
      a.group.order - b.group.order || (a.group.id < b.group.id ? -1 : 1)
  );
  const groupIds = new Set<string>();
  const declaredIn = new Map<string, string>();
  const mirrors = new Map<string, string>();
  const settings: Record<string, SettingDefinition> = {};

  for (const { group, settings: definitions } of sorted) {
    if (groupIds.has(group.id)) {
      throw new Error(`Setting group "${group.id}" is declared twice`);
    }
    groupIds.add(group.id);

    for (const definition of definitions) {
      const { key } = definition;
      const earlier = declaredIn.get(key);
      if (earlier !== undefined) {
        throw new Error(
          `Setting "${key}" is declared twice, in group "${earlier}" and in group "${group.id}"`
        );
      }
      declaredIn.set(key, group.id);
      if (definition.group !== group.id) {
        throw new Error(
          `Setting "${key}" is declared in group "${group.id}", but its key names group "${definition.group}"`
        );
      }
      if (definition.document) {
        const [kind, target] =
          "attribute" in definition.document
            ? (["attribute", definition.document.attribute] as const)
            : (["property", definition.document.property] as const);
        const owner = mirrors.get(target);
        if (owner !== undefined) {
          throw new Error(
            `Setting "${key}" writes the document ${kind} "${target}", which "${owner}" already writes`
          );
        }
        mirrors.set(target, key);
      }
      settings[key] = definition;
    }
  }

  return {
    groups: Object.freeze(sorted.map(({ group }) => group)),
    settings: Object.freeze(settings),
  };
}
