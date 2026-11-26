import { INK, INK_DARK } from "@workspace/ui/lib/brand-colours";
import { LOGO } from "@workspace/ui/lib/logo-paths";
import type { APIRoute } from "astro";

/** The Projammr mark as an SVG favicon, drawn from the same paths as the
 * client's generated icons, inked for whichever theme the browser is in. */
export const GET: APIRoute = () => {
  const shapes = LOGO.shapes
    .map((shape) => {
      const attrs = Object.entries(shape.attrs)
        .map(([name, value]) => `${name}="${String(value)}"`)
        .join(" ");
      return `<${shape.tag} ${attrs}/>`;
    })
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO.viewBox}">` +
    `<style>g{fill:${INK}}@media (prefers-color-scheme:dark){g{fill:${INK_DARK}}}</style>` +
    `<g>${shapes}</g></svg>`;

  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
};
