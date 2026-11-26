import { mock } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineGroup, defineSetting } from "@workspace/settings/define";
import { FIXTURE } from "@workspace/settings/test-support";
import { z } from "zod";

/**
 * A settings group no real one resembles yet, registered only for the tests
 * that load it: the registered groups have no key a project stores, none an
 * owner alone may write, none for admins' eyes only and none the environment
 * seeds, and the storage and routes have to handle all of those.
 */
const fixture = {
  group: defineGroup({
    id: "fixture",
    section: "project",
    label: "Fixture",
    order: 1000,
  }),
  settings: [
    /** Every scope, writable at a project by an editor, and seeded by the environment. */
    defineSetting({
      ...FIXTURE,
      key: "fixture.layered",
      group: "fixture",
      scopes: ["user", "project", "instance"],
      schema: z.string().min(1),
      default: "fallback",
      minRole: "editor",
    }),
    /** A project's own setting: no personal value, and an admin's to write. */
    defineSetting({
      ...FIXTURE,
      key: "fixture.projectOnly",
      group: "fixture",
      scopes: ["project", "instance"],
      schema: z.number().int(),
      default: 0,
    }),
    /** Operational: only an instance admin receives it. */
    defineSetting({
      ...FIXTURE,
      key: "fixture.adminOnly",
      group: "fixture",
      scopes: ["instance"],
      schema: z.boolean(),
      default: false,
      audience: "admin",
    }),
    /** A value no lock may pin. */
    defineSetting({
      ...FIXTURE,
      key: "fixture.unlockable",
      group: "fixture",
      scopes: ["user", "project", "instance"],
      schema: z.string(),
      default: "free",
      lockable: false,
    }),
  ],
};

/** What the environment seeds while the fixture group is registered. */
export const FIXTURE_ENV = { "fixture.layered": "from env" } as const;

const isGroupFile = (file: string) =>
  file.endsWith(".ts") && file !== "index.ts" && !file.endsWith(".test.ts");

/**
 * Registers the fixture group beside every real group and seeds the `env`
 * layer with {@link FIXTURE_ENV}, by standing in for the registry's group index
 * and for `settings-env.ts`. The registry is built once, when it is first
 * loaded, so this must run before anything imports `@workspace/settings` or
 * the app: a test file calls it first and imports the rest dynamically. The
 * real groups are loaded file by file, the way the index lists them, rather
 * than through the index, which would then be the one already loaded.
 *
 * A file that calls this runs in the isolated half of `bun run test`, where no
 * other file shares its modules.
 */
export async function registerFixtureSettings(): Promise<void> {
  const groups = dirname(
    fileURLToPath(import.meta.resolve("@workspace/settings/groups/index"))
  );
  const real = await Promise.all(
    readdirSync(groups)
      .filter(isGroupFile)
      .map(async (file) => [file, await import(join(groups, file))] as const)
  );
  mock.module("@workspace/settings/groups/index", () => ({
    ...Object.fromEntries(real),
    fixture,
  }));
  mock.module(
    fileURLToPath(import.meta.resolve("../db/queries/settings-env.ts")),
    () => ({ envLayer: () => FIXTURE_ENV })
  );
}
