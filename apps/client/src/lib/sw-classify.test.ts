import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classify,
  IMAGE_CACHE,
  IMAGE_CACHE_LIMIT,
  OFFLINE_URL,
  SHELL_CACHE,
  shellKey,
  STATIC_CACHE,
} from "./sw-classify";

const ORIGIN = "https://projammr.test";

function ask(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    mode?: string;
  } = {}
) {
  return classify(new URL(path, ORIGIN), {
    method: init.method ?? "GET",
    headers: new Headers(init.headers),
    mode: init.mode,
  });
}

describe("classify", () => {
  it("sends audio and every other asset to the network untouched", () => {
    expect(ask("/media/assets/take-3.mp3")).toEqual({
      strategy: "network-only",
    });
  });

  it("keeps artwork in the image cache and revalidates it behind the paint", () => {
    expect(ask("/media/images/cover.png?w=256")).toEqual({
      strategy: "swr",
      cache: IMAGE_CACHE,
    });
  });

  it("never answers a byte range from a cache", () => {
    expect(
      ask("/media/images/cover.png", { headers: { range: "bytes=0-" } })
    ).toEqual({ strategy: "network-only" });
  });

  it("leaves RSC payloads alone, by header and by query", () => {
    expect(
      ask("/project/1", { headers: { rsc: "1" }, mode: "navigate" })
    ).toEqual({
      strategy: "network-only",
    });
    expect(ask("/project/1?_rsc=abc12", { mode: "navigate" })).toEqual({
      strategy: "network-only",
    });
  });

  it("leaves a server action alone", () => {
    expect(
      ask("/project/1", { method: "POST", headers: { "next-action": "a1b2" } })
    ).toEqual({ strategy: "network-only" });
  });

  it("leaves the API alone", () => {
    expect(ask("/api/projects/1/tracks")).toEqual({ strategy: "network-only" });
  });

  it("leaves share links alone, page and stream alike", () => {
    expect(ask("/share/tok/stream")).toEqual({ strategy: "network-only" });
    expect(ask("/share/tok", { mode: "navigate" })).toEqual({
      strategy: "network-only",
    });
  });

  it("leaves anything with a body alone", () => {
    expect(ask("/", { method: "POST" })).toEqual({ strategy: "network-only" });
  });

  it("serves immutable build output from the cache first", () => {
    expect(ask("/_next/static/chunks/a.js")).toEqual({
      strategy: "cache-first",
      cache: STATIC_CACHE,
    });
  });

  it("revalidates the icons and manifest, which follow the instance's brand", () => {
    expect(ask("/icon/default")).toEqual({
      strategy: "swr",
      cache: SHELL_CACHE,
    });
    expect(ask("/apple-icon")).toEqual({ strategy: "swr", cache: SHELL_CACHE });
    expect(ask("/manifest.webmanifest")).toEqual({
      strategy: "swr",
      cache: SHELL_CACHE,
    });
  });

  it("tries the network first for a page, so the offline fallback is the exception", () => {
    expect(ask("/project/1", { mode: "navigate" })).toEqual({
      strategy: "network-first",
      cache: SHELL_CACHE,
    });
  });

  it("falls through to the network for anything it does not recognise", () => {
    expect(ask("/fonts/Redaction35.woff2")).toEqual({
      strategy: "network-only",
    });
  });

  it("never caches the DSP worklet processor, so an ABI bump is never served stale", () => {
    expect(ask("/dsp-processor.js?v=1")).toEqual({ strategy: "network-only" });
  });
});

describe("shellKey", () => {
  it("drops the content hash Next appends to an icon link, keeping the route", () => {
    expect(shellKey(new URL("/apple-icon?6357e1d1ac179353", ORIGIN))).toBe(
      "/apple-icon"
    );
  });

  it("is the bare route already for a manifest entry", () => {
    expect(shellKey(new URL("/icon/default", ORIGIN))).toBe("/icon/default");
  });
});

/**
 * `public/sw.js` is a classic worker script: it cannot import this module, so
 * it repeats the rule set. These assertions are what hold the two equal —
 * change one without the other and the suite says so.
 */
describe("public/sw.js", () => {
  const moduleSource = readFileSync(
    join(import.meta.dir, "sw-classify.ts"),
    "utf8"
  ).replaceAll("\r\n", "\n");
  const workerSource = readFileSync(
    join(import.meta.dir, "../../public/sw.js"),
    "utf8"
  ).replaceAll("\r\n", "\n");

  it("carries the same classify body", () => {
    const body = /\): Classified \{\n(.*?)\n\}\n/s.exec(moduleSource)?.[1];

    expect(body).toBeTruthy();
    expect(workerSource).toContain(
      `function classify(url, request) {\n${body}\n}`
    );
  });

  it("carries the same shellKey body", () => {
    const body = /shellKey\(url: URL\): string \{\n(.*?)\n\}\n/s.exec(
      moduleSource
    )?.[1];

    expect(body).toBeTruthy();
    expect(workerSource).toContain(`function shellKey(url) {\n${body}\n}`);
  });

  it("precaches the offline page without the member's cookies", () => {
    // With them the root layout bakes the member's theme into the page.
    expect(workerSource).toMatch(
      /new Request\(OFFLINE_URL, \{[^}]*credentials: "omit"/
    );
  });

  it("names the same caches and the same image budget", () => {
    for (const [name, value] of [
      ["STATIC_CACHE", STATIC_CACHE],
      ["IMAGE_CACHE", IMAGE_CACHE],
      ["SHELL_CACHE", SHELL_CACHE],
      ["OFFLINE_URL", OFFLINE_URL],
    ] as const) {
      expect(workerSource).toContain(`const ${name} = "${value}";`);
    }
    expect(workerSource).toContain(
      `const IMAGE_CACHE_LIMIT = ${IMAGE_CACHE_LIMIT};`
    );
  });
});
