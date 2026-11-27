import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { normalizeBasePath, stripBasePath } from "../src/lib/urls";
import { SITE } from "../src/site";

/* Starlight's link validator judges the docs only. This holds the marketing
   pages to the same standard over the built site: every internal `href` on
   them reaches a file the build wrote, and every `#hash` an element on the
   page it points at. Turbo builds the site before this suite runs
   (`web#test` in turbo.json). */

const HREF = /\bhref="([^"]*)"/g;
const ID = /\bid="([^"]*)"/g;

/** The URL path a built HTML file is served at. */
const urlOf = (file: string) =>
  "/" + file.replace(/(^|\/)index\.html$/, "$1").replace(/\\/g, "/");

async function builtFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/")
    );
}

/** Every internal link on a marketing page (anything outside `/docs/`) that
 * reaches no built file, or no element with its `#hash`, as
 * `<page> → <href>`. When `basePath` is set, every internal link must carry
 * that prefix and resolve to a built file once the prefix is stripped. */
async function brokenMarketingLinks(
  dir: string,
  basePath = ""
): Promise<string[]> {
  const basePrefix = normalizeBasePath(basePath);
  const files = new Set(await builtFiles(dir));
  const pages = [...files].filter(
    (file) => file.endsWith(".html") && !file.startsWith("docs/")
  );
  const idsOf = new Map<string, Set<string>>();
  const ids = async (file: string) => {
    let found = idsOf.get(file);
    if (!found) {
      const html = await Bun.file(join(dir, file)).text();
      found = new Set([...html.matchAll(ID)].map(([, id]) => id!));
      idsOf.set(file, found);
    }
    return found;
  };
  const fileFor = (path: string): string | undefined => {
    const decoded = decodeURIComponent(path);
    if (
      basePrefix !== "" &&
      decoded !== basePrefix &&
      !decoded.startsWith(`${basePrefix}/`)
    ) {
      return undefined;
    }
    const bare = stripBasePath(decoded, basePrefix).replace(/^\//, "");
    return [
      bare.endsWith("/") || bare === "" ? `${bare}index.html` : bare,
      `${bare}.html`,
      `${bare}/index.html`,
    ].find((candidate) => files.has(candidate));
  };

  const broken: string[] = [];
  for (const page of pages) {
    const html = await Bun.file(join(dir, page)).text();
    const pageUrl = `${basePrefix}${urlOf(page)}`;
    const base = new URL(pageUrl, "https://site.invalid");
    for (const [, raw] of html.matchAll(HREF)) {
      const href = raw!.replaceAll("&amp;", "&");
      if (href === "" || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      if (href.startsWith("//")) continue;
      const url = new URL(href, base);
      const target = fileFor(url.pathname);
      const hash = decodeURIComponent(url.hash.slice(1));
      if (!target) broken.push(`${urlOf(page)} → ${href}`);
      else if (
        hash &&
        target.endsWith(".html") &&
        !(await ids(target)).has(hash)
      )
        broken.push(`${urlOf(page)} → ${href} (no #${hash})`);
    }
  }
  return broken;
}

describe("brokenMarketingLinks", () => {
  let dir: string;
  const write = async (path: string, body: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), body);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "marketing-links-"));
    await write(
      "index.html",
      `<a href="/pricing/">p</a><a href="/#plans">h</a><a href="#plans">self</a>` +
        `<link href="/favicon.svg"><a href="https://example.com/x">out</a>` +
        `<section id="plans"></section>`
    );
    await write("pricing/index.html", `<a href="../">home</a>`);
    await write("favicon.svg", "<svg/>");
    await write("docs/index.html", `<a href="/nowhere/">docs are not ours</a>`);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes pages whose links all reach a built page, file or anchor", async () => {
    expect(await brokenMarketingLinks(dir)).toEqual([]);
  });

  it("names a link to a page the build never wrote", async () => {
    await write("dit/index.html", `<a href="/features/nowhere/">x</a>`);
    expect(await brokenMarketingLinks(dir)).toEqual([
      "/dit/ → /features/nowhere/",
    ]);
    await rm(join(dir, "dit"), { recursive: true });
  });

  it("names a link to an anchor its page does not have", async () => {
    await write("ai/index.html", `<a href="/#download">x</a>`);
    expect(await brokenMarketingLinks(dir)).toEqual([
      "/ai/ → /#download (no #download)",
    ]);
    await rm(join(dir, "ai"), { recursive: true });
  });
  it("validates base-prefixed links and rejects unprefixed root-relative links", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "marketing-links-base-"));
    try {
      await mkdir(join(baseDir, "pricing"), { recursive: true });
      await writeFile(
        join(baseDir, "index.html"),
        `<a href="/projammr/pricing/">p</a><a href="/projammr/#plans">h</a><section id="plans"></section>`
      );
      await writeFile(
        join(baseDir, "pricing/index.html"),
        `<a href="/pricing/">missing base</a>`
      );
      expect(await brokenMarketingLinks(baseDir, "/projammr")).toEqual([
        "/pricing/ → /pricing/",
      ]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe("the built marketing pages", () => {
  it("link only to pages, files and anchors the build wrote", async () => {
    const dist = join(import.meta.dir, "..", "dist");
    expect(await brokenMarketingLinks(dist, SITE.basePath)).toEqual([]);
  });
});
