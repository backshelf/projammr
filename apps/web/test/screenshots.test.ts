import { describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const SHOT = /<Screenshot\b([^>]*?)\/?>/g;
const attr = (attrs: string, name: string) =>
  new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)?.[1];

async function sources(): Promise<string[]> {
  const entries = await readdir(join(root, "src"), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((e) => e.isFile() && /\.(mdx|astro)$/.test(e.name))
    .filter((e) => e.name !== "Screenshot.astro")
    .map((e) => join(e.parentPath, e.name));
}

describe("screenshots", () => {
  it("every one the site references has been captured in both themes", async () => {
    const missing: string[] = [];
    for (const file of await sources()) {
      const text = await Bun.file(file).text();
      for (const [, attrs = ""] of text.matchAll(SHOT)) {
        const id = attr(attrs, "id");
        if (!id) continue;
        const viewport = attr(attrs, "viewport") ?? "desktop";
        for (const theme of ["light", "dark"]) {
          const shot = `src/assets/screenshots/${id}.${theme}.${viewport}.webp`;
          if (!(await Bun.file(join(root, shot)).exists())) {
            missing.push(`${relative(root, file)} → ${shot}`);
          }
        }
      }
    }
    expect(missing, "capture them with apps/web/scripts/screenshots").toEqual(
      []
    );
  });
});
