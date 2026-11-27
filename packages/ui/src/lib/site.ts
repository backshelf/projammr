/** Facts about the product's own site, read by the marketing site
 * (`apps/web`), which names the product itself. The client names the
 * instance it is running against through the brand (`lib/brand.ts`,
 * `lib/brand-context.tsx`) instead of `name` here. `origin` and `basePath`
 * split `url` for Astro's `site` and `base` settings. */
export const SITE = {
  name: "Projammr",
  origin: "https://backshelf.github.io",
  basePath: "/projammr",
  url: "https://backshelf.github.io/projammr",
  repository: "https://github.com/backshelf/projammr",
  license: "AGPL-3.0",
} as const;

/**
 * Where the dit desktop app is downloaded: the macOS build attached to the
 * latest release.
 */
export const DESKTOP_APP_DOWNLOAD_URL = `${SITE.repository}/releases/latest/download/dit-macos-arm64.dmg`;
