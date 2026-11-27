import {
  defineMdastPlugin,
  type MdastPluginDefinition,
  type MdastVisitorContext,
  type MdxJsxFlowElement,
  type MdxJsxTextElement,
} from "satteri";

import { normalizeBasePath, siteHref } from "./urls";

/** MDX elements whose string URL attributes should receive the site base path. */
const JSX_URL_ATTRS: Record<string, readonly string[]> = {
  a: ["href"],
  img: ["src"],
  LinkCard: ["href"],
  LinkButton: ["href"],
};

function rewriteJsxUrls(
  node: Readonly<MdxJsxFlowElement | MdxJsxTextElement>,
  ctx: MdastVisitorContext,
  base: string
) {
  if (!node.name) return;
  const attrNames = JSX_URL_ATTRS[node.name];
  if (!attrNames) return;

  for (const attr of node.attributes) {
    if (
      attr.type === "mdxJsxAttribute" &&
      attrNames.includes(attr.name) &&
      typeof attr.value === "string"
    ) {
      const next = siteHref(attr.value, base);
      if (next !== attr.value) {
        ctx.setAttribute(node, attr.name, next);
      }
    }
  }
}

/** Sätteri MDAST plugin that prefixes root-relative Markdown links, images,
 * definitions, and MDX link components (`LinkCard`, `LinkButton`, `a`, `img`)
 * with `basePath` so docs stay authored as root-relative paths (`/docs/...`,
 * `/dit/`). Runs before HAST conversion, so `starlight-links-validator` sees
 * the prefixed URLs and validates them against Astro's configured `base`. */
export function remarkBaseUrl(basePath: string): MdastPluginDefinition {
  const base = normalizeBasePath(basePath);
  const nextUrl = (url: string) => (base === "" ? url : siteHref(url, base));

  return defineMdastPlugin({
    name: "projammr:base-url",
    link(node, ctx) {
      const next = nextUrl(node.url);
      if (next !== node.url) ctx.setField(node, "url", next);
    },
    image(node, ctx) {
      const next = nextUrl(node.url);
      if (next !== node.url) ctx.setField(node, "url", next);
    },
    definition(node, ctx) {
      const next = nextUrl(node.url);
      if (next !== node.url) ctx.setField(node, "url", next);
    },
    mdxJsxFlowElement(node, ctx) {
      if (base === "") return;
      rewriteJsxUrls(node, ctx, base);
    },
    mdxJsxTextElement(node, ctx) {
      if (base === "") return;
      rewriteJsxUrls(node, ctx, base);
    },
  });
}
