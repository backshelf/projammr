import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `server.ts` loads the stored instance settings before it imports the app,
 * because `auth.ts` takes the running policy as it is first evaluated. A
 * static import that reached either module from `server.ts` would evaluate it
 * ahead of the load, on the environment's policy, and nothing else would say
 * so: the server would boot and quietly ignore the stored session lifetime
 * and MCP switch.
 */
const here = dirname(fileURLToPath(import.meta.url));
const transpiler = new Bun.Transpiler({ loader: "ts" });

/** The source file a relative specifier names, or null for a package. */
function sourceOf(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const path = resolve(dirname(from), specifier).replace(/\.js$/, ".ts");
  return existsSync(path) ? path : null;
}

/** Every source file `entry` loads before its body runs: its static imports, all the way down. */
function staticallyLoaded(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { path, kind } of transpiler.scanImports(
      readFileSync(file, "utf8")
    )) {
      if (kind === "dynamic-import") continue;
      const next = sourceOf(file, path);
      if (next) visit(next);
    }
  };
  visit(entry);
  return seen;
}

describe("server.ts", () => {
  it("reaches neither the app nor auth.ts through a static import", () => {
    const loaded = staticallyLoaded(resolve(here, "server.ts"));

    expect(loaded.has(resolve(here, "db/queries/settings.ts"))).toBe(true);
    expect(loaded.has(resolve(here, "app.ts"))).toBe(false);
    expect(loaded.has(resolve(here, "auth.ts"))).toBe(false);
  });
});
