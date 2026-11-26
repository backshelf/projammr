import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

import { SPEC_FILES } from "./scripts/openapi";
import { jsBudget } from "./src/integrations/js-budget";
import { SITE } from "./src/site";

export default defineConfig({
  site: SITE.url,
  server: { port: Number(process.env.WEB_PORT ?? 4321) },
  integrations: [
    starlight({
      title: SITE.name,
      disable404Route: true,
      favicon: "/favicon.svg",
      customCss: ["./src/styles/docs.css"],
      components: {
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        SocialIcons: "./src/components/starlight/SocialIcons.astro",
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
      },
      social: [{ icon: "github", label: "GitHub", href: SITE.repository }],
      plugins: [
        starlightOpenAPI([
          {
            base: "docs/api/reference",
            schema: SPEC_FILES.api,
            sidebar: {
              label: "Endpoint reference",
              collapsed: true,
              operations: { badges: true },
            },
          },
          /* Better Auth's spec carries no summaries, so its operations are
             listed by path rather than by generated operation id. */
          {
            base: "docs/api/auth-reference",
            schema: SPEC_FILES.auth,
            sidebar: {
              label: "Auth endpoint reference",
              collapsed: true,
              operations: { badges: true, labels: "path" },
            },
          },
        ]),
        /* The validator knows only Starlight's content pages; the marketing
           routes are Astro pages beside it, and starlight-openapi injects the
           reference's pages as routes, so links to either are not its to
           judge. */
        starlightLinksValidator({
          exclude: [
            "/",
            "/dit/",
            "/pricing/",
            "/ai/",
            "/features/**",
            "/docs/api/reference/",
            "/docs/api/reference/**",
            "/docs/api/auth-reference/",
            "/docs/api/auth-reference/**",
          ],
        }),
      ],
      sidebar: [
        /* Each group autogenerates one flat directory: Starlight labels a
           nested directory's group with its raw name, and that label cannot
           be set. A new group is a new directory under docs/ and an entry
           here. */
        {
          label: "Using Projammr",
          items: [{ autogenerate: { directory: "docs/guide" } }],
        },
        {
          label: "Working together",
          items: [{ autogenerate: { directory: "docs/collaboration" } }],
        },
        {
          label: "Running an instance",
          items: [{ autogenerate: { directory: "docs/admin" } }],
        },
        {
          label: "API",
          items: [
            { autogenerate: { directory: "docs/api" } },
            ...openAPISidebarGroups,
          ],
        },
        {
          label: "Self-hosting",
          items: [{ autogenerate: { directory: "docs/self-hosting" } }],
        },
        {
          label: "Contributing",
          items: [{ autogenerate: { directory: "docs/contributing" } }],
        },
      ],
    }),
    react(),
    sitemap(),
    jsBudget(),
  ],
  vite: {
    plugins: [tailwindcss()],
    /* Starlight's markdown processor, satteri, loads a native binding by
       platform. Bundled into the prerender chunk, that `require` resolves from
       `dist/` and cannot see Bun's isolated install; left external (and so
       declared as dependencies of this package), each resolves its binding
       from its own install. */
    environments: {
      prerender: {
        resolve: { external: ["satteri", "@astrojs/markdown-satteri"] },
      },
    },
  },
});
