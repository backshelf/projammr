import { SETTINGS } from "@workspace/settings";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth.js";
import { instanceImagePaths } from "../db/queries/images.js";
import {
  hasAccounts,
  instanceSetting,
  instanceValues,
  publicSettings,
  publicSettingsSchema,
} from "../db/queries/settings.js";
import { emailEnabled } from "../lib/env.js";
import { describer, respond } from "../lib/http.js";
import {
  instancePolicy,
  onInstancePolicyChange,
} from "../lib/instance-policy.js";
import { appVersion } from "../lib/version.js";

/** The group for facts about the instance itself, `app.ts`'s health check included. */
export const instanceDocs = describer("Instance");
const { describe } = instanceDocs;

const app = new Hono<{ Variables: AuthType }>({ strict: false });

/** Each `brand` field's setting. */
const BRAND = {
  name: "instance-branding.name",
  logoImageId: "instance-branding.logoImageId",
  iconImageId: "instance-branding.iconImageId",
  themeColour: "instance-branding.themeColour",
  backgroundColour: "instance-branding.backgroundColour",
} as const;

/** How the instance presents itself: its name, its images and its colours. */
const brandSchema = z.object({
  name: SETTINGS[BRAND.name].schema,
  /** The instance's own mark, an instance image; null uses Projammr's. */
  logoImageId: SETTINGS[BRAND.logoImageId].schema,
  /** The instance's own app icon; null derives it from the logo, or uses Projammr's. */
  iconImageId: SETTINGS[BRAND.iconImageId].schema,
  themeColour: SETTINGS[BRAND.themeColour].schema,
  backgroundColour: SETTINGS[BRAND.backgroundColour].schema,
  /**
   * The logo's stored key, which the static route (`/static/<key>`, with
   * `?w=` for a resize) serves to anyone, signed in or not. Null when no logo
   * is set or its image no longer exists, which a reader treats as none.
   */
  logoImagePath: z.string().nullable(),
  /** The icon's stored key, as `logoImagePath`. */
  iconImagePath: z.string().nullable(),
});

/** The brand as the settings give it, with each image's stored key while the image exists. */
async function readBrand(): Promise<z.output<typeof brandSchema>> {
  const brand = await instanceValues(Object.values(BRAND));
  const logoImageId = brand[BRAND.logoImageId];
  const iconImageId = brand[BRAND.iconImageId];
  const paths = await instanceImagePaths(
    [logoImageId, iconImageId].filter((id) => id !== null)
  );
  const pathOf = (id: number | null) =>
    id === null ? null : (paths.get(id) ?? null);

  return {
    name: brand[BRAND.name],
    logoImageId,
    iconImageId,
    themeColour: brand[BRAND.themeColour],
    backgroundColour: brand[BRAND.backgroundColour],
    logoImagePath: pathOf(logoImageId),
    iconImagePath: pathOf(iconImageId),
  };
}

/**
 * What this instance is, to a caller who has not signed in — which is the
 * whole point of it: the sign-in page decides between "create the first
 * account", "sign in or register" and "sign in" from `registration` and
 * `hasUsers`, and hides password recovery when the instance can send no mail.
 */
export const instanceSchema = z.object({
  registration: SETTINGS["instance-access.registration"].schema,
  /** Whether anyone has claimed this instance yet. */
  hasUsers: z.boolean(),
  emailEnabled: z.boolean(),
  version: z.string(),
  /** Whether the client should look up the latest release. */
  updateCheck: z.boolean(),
  /** The shortest and longest password a sign-up, reset or change may set. */
  passwordMin: z.number().int(),
  passwordMax: z.number().int(),
  /** Whether a signed-out reader or a guest may open a share or invite link. */
  guestAccess: z.boolean(),
  /** Whether an account holder may delete their own account. */
  selfDeletion: z.boolean(),
  brand: brandSchema,
  /** Every `audience: "public"` setting, for a page with no one signed in. */
  settings: publicSettingsSchema,
});

const INSTANCE_CACHE_TTL_MS = 5_000;
let cachedInstancePayload: {
  expiresAt: number;
  data: z.output<typeof instanceSchema>;
} | null = null;

onInstancePolicyChange(() => {
  cachedInstancePayload = null;
});

app.get(
  "/",
  describe(
    "Public facts about this instance: whether it takes registrations, whether it has an account yet, and what it is running.",
    { schema: instanceSchema, description: "Instance" }
  ),
  async (c) => {
    const now = Date.now();
    if (
      process.env.NODE_ENV !== "test" &&
      cachedInstancePayload &&
      cachedInstancePayload.expiresAt > now
    ) {
      return respond(c, instanceSchema, cachedInstancePayload.data);
    }

    const [registration, hasUsers, settings, brand] = await Promise.all([
      instanceSetting(SETTINGS["instance-access.registration"]),
      hasAccounts(),
      publicSettings(),
      readBrand(),
    ]);
    const { access, integrations } = instancePolicy();
    const data: z.output<typeof instanceSchema> = {
      registration,
      hasUsers,
      emailEnabled,
      updateCheck: integrations.updateCheck,
      version: appVersion,
      passwordMin: access.passwordMin,
      passwordMax: access.passwordMax,
      guestAccess: access.guestAccess,
      selfDeletion: access.selfDeletion,
      brand,
      settings,
    };
    if (process.env.NODE_ENV !== "test") {
      cachedInstancePayload = { expiresAt: now + INSTANCE_CACHE_TTL_MS, data };
    }

    return respond(c, instanceSchema, data);
  }
);

export default app;
