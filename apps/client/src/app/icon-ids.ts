/**
 * The icon variants app/icon.tsx generates via `generateImageMetadata`, kept
 * in a plain module so app/manifest.ts and its test can reference the exact
 * routes Next serves (`/icon/<id>`) without importing the JSX route file.
 */
export const ICONS = [
  { id: "default", size: 512, purpose: "any" },
  { id: "maskable", size: 512, purpose: "maskable" },
  { id: "small", size: 192, purpose: "any" },
] as const;

export type IconId = (typeof ICONS)[number]["id"];
