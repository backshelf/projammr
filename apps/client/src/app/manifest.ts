import type { MetadataRoute } from "next";
import { cachedBrand } from "@/lib/brand";
import { PROJECTS_HREF } from "@/lib/utils";
import { ICONS } from "./icon-ids";

type IconEntry = (typeof ICONS)[number];

const SHORTCUT_ICON = ICONS.find((icon) => icon.id === "small") ?? ICONS[0];

function iconEntry({ id, size, purpose }: IconEntry) {
  return {
    src: `/icon/${id}`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  };
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await cachedBrand();

  return {
    id: "/",
    name: brand.name,
    short_name: brand.name,
    description:
      "Project management for music — tracks, sessions and collections.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The splash screen is the room the app opens in, before a stylesheet or
    // the theme preference has been read.
    background_color: brand.backgroundColour,
    // The manifest has no media-query equivalent, so this is the one value
    // for both themes; layout.tsx's `viewport.themeColor` is the theme-aware
    // one the browser actually uses once the page has loaded.
    theme_color: brand.themeColour,
    icons: ICONS.map(iconEntry),
    shortcuts: [
      { name: "Projects", url: PROJECTS_HREF },
      { name: "Notes", url: "/notes" },
    ].map((shortcut) => ({
      ...shortcut,
      icons: [iconEntry(SHORTCUT_ICON)],
    })),
  };
}
