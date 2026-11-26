import { z } from "zod";
import { defineGroup, defineSetting, INSTANCE_ONLY } from "../define.js";

/** The product's own name, which an instance goes by until it names itself. */
const PRODUCT_NAME = "Projammr";

/**
 * The dark theme's paper (`--paper`, `oklch(0.135 0 0)`), which the web
 * app's manifest has always used for both its colours.
 */
const DARK_PAPER = "#080808";

const displayName = z.string().trim().min(1).max(60);

/** A six-digit hex colour, as a manifest and a colour picker both take it. */
const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i, {
  error: "Use a hex colour, like #1a2b3c",
});

/** An uploaded image of the instance's own; none is the absence of a row. */
const instanceImage = z.number().int().positive().nullable();

export const group = defineGroup({
  id: "instance-branding",
  section: "instance",
  label: "Branding",
  description:
    "What this instance is called and how it looks to everyone who opens it, signed in or not.",
  order: 20,
});

export const settings = [
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.name",
    group: "instance-branding",
    label: "Name",
    description:
      "What the instance calls itself: page titles, the sign-in page, share pages and mail.",
    keywords: ["title", "brand", "instance name", "product name"],
    schema: displayName,
    default: PRODUCT_NAME,
    control: { kind: "text", placeholder: PRODUCT_NAME },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.logoImageId",
    group: "instance-branding",
    label: "Logo",
    description:
      "The mark beside the name on the sign-in page, share pages and mail. Without one, the Projammr mark shows.",
    keywords: ["mark", "brand", "image", "wordmark"],
    schema: instanceImage,
    default: null,
    control: { kind: "custom", component: "image" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.iconImageId",
    group: "instance-branding",
    label: "App icon",
    description:
      "The icon browsers and home screens show. Without one it comes from the logo, or the Projammr icon when there is no logo either.",
    keywords: ["favicon", "icon", "home screen", "brand", "image"],
    schema: instanceImage,
    default: null,
    control: { kind: "custom", component: "image" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.themeColour",
    group: "instance-branding",
    label: "Theme colour",
    description:
      "The colour a phone or a browser tints its own bar with around the installed app.",
    keywords: ["colour", "color", "manifest", "brand", "toolbar"],
    schema: hexColour,
    default: DARK_PAPER,
    control: { kind: "colour" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.backgroundColour",
    group: "instance-branding",
    label: "Background colour",
    description: "The colour behind the icon while the installed app opens.",
    keywords: ["colour", "color", "manifest", "splash", "brand"],
    schema: hexColour,
    default: DARK_PAPER,
    control: { kind: "colour" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.mailSenderName",
    group: "instance-branding",
    label: "Mail sender name",
    description:
      "The name mail from this instance comes from. The address stays the one the server is configured with.",
    keywords: ["email", "from", "sender", "mail"],
    schema: displayName,
    default: PRODUCT_NAME,
    control: { kind: "text", placeholder: PRODUCT_NAME },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-branding.updateCheck",
    group: "instance-branding",
    label: "Look for new releases",
    description:
      "The About page says when a newer release is out, by asking GitHub from the admin's own browser. Off, nothing is asked.",
    keywords: ["update", "release", "version", "github", "about"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "public",
  }),
];
