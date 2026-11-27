import { describe, expect, it } from "bun:test";
import { markdownToHtml, mdxToJs } from "satteri";

import { remarkBaseUrl } from "./remark-base-url";

describe("remarkBaseUrl", () => {
  it("prefixes root-relative markdown links, images and definitions", async () => {
    const md = [
      "[Guide](/docs/guide/)",
      "[dit](/dit/#download)",
      "![Cover](/images/cover.png)",
      "[Ref][ref]",
      "",
      "[ref]: /docs/self-hosting/https/",
    ].join("\n");

    const { html } = await markdownToHtml(md, {
      mdastPlugins: [remarkBaseUrl("/projammr")],
    });

    expect(html).toContain('href="/projammr/docs/guide/"');
    expect(html).toContain('href="/projammr/dit/#download"');
    expect(html).toContain('src="/projammr/images/cover.png"');
    expect(html).toContain('href="/projammr/docs/self-hosting/https/"');
  });

  it("leaves already-prefixed, external, relative and hash-only links untouched", async () => {
    const md = [
      "[Already](/projammr/docs/guide/)",
      "[External](https://github.com/backshelf/projammr)",
      "[Hash](#section)",
      "[Relative](./sibling/)",
    ].join("\n");

    const { html } = await markdownToHtml(md, {
      mdastPlugins: [remarkBaseUrl("/projammr")],
    });

    expect(html).toContain('href="/projammr/docs/guide/"');
    expect(html).not.toContain("/projammr/projammr/");
    expect(html).toContain('href="https://github.com/backshelf/projammr"');
    expect(html).toContain('href="#section"');
    expect(html).toContain('href="./sibling/"');
  });

  it("rewrites LinkCard, LinkButton and JSX anchor/image URLs in MDX", async () => {
    const mdx = [
      '<LinkCard title="Quickstart" href="/docs/self-hosting/quickstart/" />',
      '<LinkButton href="/dit/">Download dit</LinkButton>',
      '<a href="/pricing/">Pricing</a>',
      '<a href="https://example.com">External</a>',
    ].join("\n\n");

    const { code } = await mdxToJs(mdx, {
      mdastPlugins: [remarkBaseUrl("/projammr")],
    });

    expect(code).toContain('href: "/projammr/docs/self-hosting/quickstart/"');
    expect(code).toContain('href: "/projammr/dit/"');
    expect(code).toContain('href: "/projammr/pricing/"');
    expect(code).toContain('href: "https://example.com"');
  });

  it("is a no-op when basePath is root", async () => {
    const { html } = await markdownToHtml("[Guide](/docs/guide/)", {
      mdastPlugins: [remarkBaseUrl("/")],
    });
    expect(html).toContain('href="/docs/guide/"');
  });
});
