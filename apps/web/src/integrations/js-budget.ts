import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";

import { normalizeBasePath, stripBasePath } from "../lib/urls";

/** What a marketing page may spend on script: the inline theme script and
 * Astro's link prefetch, with room to spare, and nothing like a framework
 * runtime. The docs are exempt: search and the contents panel are theirs. */
const MARKETING_JS_BUDGET_BYTES = 6 * 1024;

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const SRC = /\bsrc="([^"]+)"/;

/** A static import in built code, as Vite writes one: `import"./x.js"`, or
 * `import{a}from"./x.js"` and `export{a}from"./x.js"`, always to a relative or
 * root path. A dynamic `import()` is left out: the site's only ones load code
 * on demand (Starlight's search fetches its UI when the dialog opens), which
 * is not part of what a page runs as it loads. */
const STATIC_IMPORT = /\b(?:import|from)\s*["']((?:\.{1,2})?\/[^"']+)["']/g;

/** A URL path resolved against the path of the page or module it appears in. */
const resolvePath = (specifier: string, from: string) =>
  new URL(specifier, new URL(from, "https://site.invalid")).pathname;

/** The bytes of script one built page runs as it loads: every inline script's
 * body, every script file it loads, and every chunk those import statically,
 * each file counted once. Files are read through `readAsset` by URL path;
 * `pagePath` is the page's own, which relative paths resolve against. */
export async function pageScriptBytes(
  html: string,
  pagePath: string,
  readAsset: (path: string) => Promise<string>
): Promise<number> {
  const counted = new Set<string>();

  const importedBytes = async (code: string, from: string) => {
    let total = 0;
    for (const [, specifier] of code.matchAll(STATIC_IMPORT)) {
      total += await fileBytes(resolvePath(specifier!, from));
    }
    return total;
  };

  const fileBytes = async (path: string): Promise<number> => {
    if (counted.has(path)) return 0;
    counted.add(path);
    const code = await readAsset(path);
    return Buffer.byteLength(code) + (await importedBytes(code, path));
  };

  let total = 0;
  for (const [, attributes, body = ""] of html.matchAll(SCRIPT)) {
    const src = SRC.exec(attributes ?? "")?.[1];
    total += src
      ? await fileBytes(resolvePath(src, pagePath))
      : Buffer.byteLength(body) + (await importedBytes(body, pagePath));
  }
  return total;
}

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Fails the build when a marketing page ships more script than the budget,
 * naming each page and what it spent. */
export function jsBudget(): AstroIntegration {
  let base = "";
  return {
    name: "projammr:js-budget",
    hooks: {
      "astro:config:done": ({ config }) => {
        base = normalizeBasePath(config.base);
      },
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const readAsset = (path: string) =>
          readFile(join(root, stripBasePath(path, base)), "utf8");
        const over: string[] = [];
        for (const file of await htmlFiles(root)) {
          const rel = "/" + relative(root, file).replaceAll("\\", "/");
          if (rel.startsWith("/docs/")) continue;
          const bytes = await pageScriptBytes(
            await readFile(file, "utf8"),
            `${base}${rel}`,
            readAsset
          );
          if (bytes > MARKETING_JS_BUDGET_BYTES)
            over.push(`${rel}: ${bytes} bytes`);
        }
        if (over.length > 0) {
          throw new Error(
            `Marketing pages over the ${MARKETING_JS_BUDGET_BYTES}-byte script budget:\n` +
              over.join("\n")
          );
        }
        logger.info("every marketing page is within the script budget");
      },
    },
  };
}
