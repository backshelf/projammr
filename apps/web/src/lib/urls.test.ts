import { describe, expect, it } from "bun:test";

import { normalizeBasePath, siteHref, stripBasePath } from "./urls";

describe("normalizeBasePath", () => {
  it("normalises root and empty values to empty string", () => {
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("///")).toBe("");
  });

  it("ensures a single leading slash and no trailing slash", () => {
    expect(normalizeBasePath("/projammr")).toBe("/projammr");
    expect(normalizeBasePath("/projammr/")).toBe("/projammr");
    expect(normalizeBasePath("projammr")).toBe("/projammr");
    expect(normalizeBasePath("projammr/")).toBe("/projammr");
    expect(normalizeBasePath("/nested/site/")).toBe("/nested/site");
  });
});

describe("siteHref", () => {
  it("prefixes root-relative paths when base is set", () => {
    expect(siteHref("/", "/projammr")).toBe("/projammr/");
    expect(siteHref("/dit/", "/projammr")).toBe("/projammr/dit/");
    expect(siteHref("/#features", "/projammr")).toBe("/projammr/#features");
    expect(siteHref("/dit/#download", "/projammr")).toBe(
      "/projammr/dit/#download"
    );
    expect(siteHref("/favicon.svg", "/projammr/")).toBe(
      "/projammr/favicon.svg"
    );
    expect(siteHref("/docs/guide/?tab=1", "/projammr")).toBe(
      "/projammr/docs/guide/?tab=1"
    );
  });

  it("is idempotent when the path already carries the base prefix", () => {
    expect(siteHref("/projammr", "/projammr")).toBe("/projammr");
    expect(siteHref("/projammr/", "/projammr")).toBe("/projammr/");
    expect(siteHref("/projammr/dit/", "/projammr")).toBe("/projammr/dit/");
    expect(siteHref("/projammr#plans", "/projammr")).toBe("/projammr#plans");
    expect(siteHref("/projammr?x=1", "/projammr")).toBe("/projammr?x=1");
  });

  it("does not confuse a path that merely starts with the same letters", () => {
    expect(siteHref("/projammr-docs/", "/projammr")).toBe(
      "/projammr/projammr-docs/"
    );
  });

  it("leaves external, protocol-relative, relative, hash and empty paths untouched", () => {
    expect(siteHref("https://github.com/backshelf/projammr", "/projammr")).toBe(
      "https://github.com/backshelf/projammr"
    );
    expect(siteHref("http://localhost:8080", "/projammr")).toBe(
      "http://localhost:8080"
    );
    expect(siteHref("mailto:hello@example.com", "/projammr")).toBe(
      "mailto:hello@example.com"
    );
    expect(siteHref("//cdn.example.com/app.js", "/projammr")).toBe(
      "//cdn.example.com/app.js"
    );
    expect(siteHref("#plans", "/projammr")).toBe("#plans");
    expect(siteHref("?q=test", "/projammr")).toBe("?q=test");
    expect(siteHref("./sibling/", "/projammr")).toBe("./sibling/");
    expect(siteHref("../parent/", "/projammr")).toBe("../parent/");
    expect(siteHref("", "/projammr")).toBe("");
  });

  it("returns root-relative paths unchanged when base is root", () => {
    expect(siteHref("/", "/")).toBe("/");
    expect(siteHref("/dit/", "/")).toBe("/dit/");
    expect(siteHref("/dit/", "")).toBe("/dit/");
  });
});

describe("stripBasePath", () => {
  it("strips the base path from prefixed paths", () => {
    expect(stripBasePath("/projammr", "/projammr")).toBe("/");
    expect(stripBasePath("/projammr/", "/projammr")).toBe("/");
    expect(stripBasePath("/projammr/dit/", "/projammr")).toBe("/dit/");
    expect(stripBasePath("/projammr/_astro/app.js", "/projammr/")).toBe(
      "/_astro/app.js"
    );
    expect(stripBasePath("/projammr#plans", "/projammr")).toBe("/#plans");
    expect(stripBasePath("/projammr?q=1", "/projammr")).toBe("/?q=1");
  });

  it("leaves paths outside the base untouched", () => {
    expect(stripBasePath("/dit/", "/projammr")).toBe("/dit/");
    expect(stripBasePath("/projammr-other/", "/projammr")).toBe(
      "/projammr-other/"
    );
    expect(stripBasePath("/dit/", "/")).toBe("/dit/");
  });
});
