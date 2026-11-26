/** Facts about the product's own site, read by the marketing site
 * (`apps/web`), which names the product itself. The client names the
 * instance it is running against through the brand (`lib/brand.ts`,
 * `lib/brand-context.tsx`) instead of `name` here. The domain is a
 * placeholder until one is chosen: `.example` is a reserved TLD, so nothing
 * can ever resolve it by accident. */
export const SITE = {
  name: "Projammr",
  url: "https://projammr.example",
  repository: "https://github.com/backshelf/projammr",
  license: "AGPL-3.0",
} as const;

/**
 * Where the dit desktop app is downloaded: the macOS build attached to the
 * latest release.
 */
export const DESKTOP_APP_DOWNLOAD_URL = `${SITE.repository}/releases/latest/download/dit-macos-arm64.dmg`;
