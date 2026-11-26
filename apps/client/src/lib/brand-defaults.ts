import { SETTINGS } from "@workspace/settings";
import type { Instance } from "@workspace/api/api";

/** This instance's name, mark and colours, as `GET /api/instance` carries them. */
export type Brand = Instance["brand"];

/**
 * The brand a page renders with when the instance cannot be read (signed out
 * with the API down) or has set nothing of its own: the product's own name,
 * no uploaded mark, and the colours the manifest has always used. Built from
 * the registry defaults rather than a literal, so this is the one place the
 * product's name is spelled out for the client to fall back to.
 */
export const DEFAULT_BRAND: Brand = {
  name: SETTINGS["instance-branding.name"].default,
  logoImageId: SETTINGS["instance-branding.logoImageId"].default,
  iconImageId: SETTINGS["instance-branding.iconImageId"].default,
  themeColour: SETTINGS["instance-branding.themeColour"].default,
  backgroundColour: SETTINGS["instance-branding.backgroundColour"].default,
  logoImagePath: null,
  iconImagePath: null,
};

/** Whether an instance still presents as the product itself: the default
 *  name and no uploaded logo. */
export function isDefaultBrand(brand: Brand): boolean {
  return (
    brand.name === DEFAULT_BRAND.name &&
    !brand.logoImageId &&
    !brand.logoImagePath
  );
}
