import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { jsBudget, pageScriptBytes } from "../src/integrations/js-budget";

const reader = (assets: Record<string, string>) => async (path: string) => {
  const body = assets[path];
  if (body === undefined) throw new Error(`no asset ${path}`);
  return body;
};

const readAsset = reader({ "/_astro/page.js": "x".repeat(2500) });

describe("pageScriptBytes", () => {
  it("counts an inline script's body", async () => {
    const html = `<head><script>let a = 1;</script></head>`;
    expect(await pageScriptBytes(html, "/", readAsset)).toBe(
      "let a = 1;".length
    );
  });

  it("counts a loaded script by the size of its file", async () => {
    const html = `<script type="module" src="/_astro/page.js"></script>`;
    expect(await pageScriptBytes(html, "/", readAsset)).toBe(2500);
  });

  it("adds every script on the page", async () => {
    const html =
      `<script>abc</script>` +
      `<script type="module" src="/_astro/page.js"></script>` +
      `<script is:inline>de</script>`;
    expect(await pageScriptBytes(html, "/", readAsset)).toBe(3 + 2500 + 2);
  });

  it("counts nothing on a page with no script", async () => {
    expect(
      await pageScriptBytes(`<main><p>hi</p></main>`, "/", readAsset)
    ).toBe(0);
  });

  describe("with code Vite split into shared chunks", () => {
    const entry = `import"./shared.js";`;
    const named = `import{t as e}from"./shared.js";e();`;
    const shared = "y".repeat(1900);
    const assets = reader({
      "/_astro/entry.js": entry,
      "/_astro/named.js": named,
      "/_astro/shared.js": shared,
    });

    it("counts the chunks an entry imports", async () => {
      const html = `<script type="module" src="/_astro/entry.js"></script>`;
      expect(await pageScriptBytes(html, "/", assets)).toBe(
        entry.length + shared.length
      );
    });

    it("counts a chunk once, however many scripts import it", async () => {
      const html =
        `<script type="module" src="/_astro/entry.js"></script>` +
        `<script type="module" src="/_astro/named.js"></script>`;
      expect(await pageScriptBytes(html, "/", assets)).toBe(
        entry.length + named.length + shared.length
      );
    });

    it("follows imports through re-exports, each relative to its importer, and stops at a cycle", async () => {
      const a = `export{b}from"./lib/b.js";import"/_astro/a.js";`;
      const b = `import"../c.js";export const b=1;`;
      const c = `import"./a.js";`;
      const html = `<script type="module" src="/_astro/a.js"></script>`;
      const bytes = await pageScriptBytes(
        html,
        "/",
        reader({
          "/_astro/a.js": a,
          "/_astro/lib/b.js": b,
          "/_astro/c.js": c,
        })
      );
      expect(bytes).toBe(a.length + b.length + c.length);
    });

    it("follows an inline module script's imports from the page's own path", async () => {
      const html = `<script type="module">import"../_astro/shared.js";</script>`;
      expect(await pageScriptBytes(html, "/pricing/index.html", assets)).toBe(
        `import"../_astro/shared.js";`.length + shared.length
      );
    });

    it("leaves out a chunk only a dynamic import() loads", async () => {
      const lazy = `document.onclick=()=>import("./search.js");`;
      const html = `<script type="module" src="/_astro/lazy.js"></script>`;
      const bytes = await pageScriptBytes(
        html,
        "/",
        reader({ "/_astro/lazy.js": lazy })
      );
      expect(bytes).toBe(lazy.length);
    });
  });
});

describe("jsBudget integration", () => {
  let dir: string;
  const write = async (path: string, body: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), body);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "js-budget-"));
    await write("index.html", `<script>let a = 1;</script>`);
    await write(
      "pricing/index.html",
      `<script type="module">import "../_astro/small.js";</script>`
    );
    await write("_astro/small.js", "export const x = 1;");
    await write(
      "docs/guide/index.html",
      `<script>${"x".repeat(10_000)}</script>`
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exempts nested /docs/ pages and resolves nested marketing pages", async () => {
    const done = jsBudget().hooks["astro:build:done"]!;
    await expect(
      done({
        dir: pathToFileURL(dir),
        pages: [],
        assets: new Map(),
        logger: { info: () => {} } as unknown as Parameters<
          typeof done
        >[0]["logger"],
      })
    ).resolves.toBeUndefined();
  });

  it("strips the configured base path when resolving assets from dist/", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "js-budget-base-"));
    try {
      await mkdir(join(baseDir, "_astro"), { recursive: true });
      await writeFile(
        join(baseDir, "index.html"),
        `<script type="module" src="/projammr/_astro/app.js"></script>`
      );
      await writeFile(join(baseDir, "_astro/app.js"), "export const x = 1;");

      const integration = jsBudget();
      const configDone = integration.hooks["astro:config:done"]!;
      await configDone({
        config: { base: "/projammr" },
      } as unknown as Parameters<typeof configDone>[0]);

      const done = integration.hooks["astro:build:done"]!;
      await expect(
        done({
          dir: pathToFileURL(baseDir),
          pages: [],
          assets: new Map(),
          logger: { info: () => {} } as unknown as Parameters<
            typeof done
          >[0]["logger"],
        })
      ).resolves.toBeUndefined();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
