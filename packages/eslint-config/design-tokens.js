/**
 * Flags the class names the design language does not have: the Tailwind type
 * scale, arbitrary sizes, palette hues, box shadows and colour literals. Each
 * one is a place where a surface stops sharing the token layer and starts
 * being its own thing, which is how a codebase ends up with four greys.
 *
 * Opt-in. A config that wants it spreads it under a `files` glob:
 *
 *     import { designTokens } from "@workspace/eslint-config/design-tokens";
 *     …
 *     { files: ["src/renderer/**\/*.{ts,tsx}"], ...designTokens },
 *
 * See `DESIGN.md` Typography, Colors and Do's and Don'ts
 * for what each replacement is.
 */

const BANNED = [
  {
    pattern: "text-(xs|sm|base|lg|xl|2xl)\\b",
    message:
      "Tailwind's type scale is not the design language's. Use text-micro, text-small, text-body, text-lead, text-subtitle, text-title or text-display (DESIGN.md Typography).",
  },
  {
    pattern: "text-\\[",
    message:
      "Arbitrary font sizes drift off the scale. Use the nearest step; text-micro is the floor (DESIGN.md Typography).",
  },
  {
    pattern:
      "(emerald|amber|blue|purple|sky|teal|rose|green|red|orange|indigo|violet|lime|cyan|fuchsia|pink)-\\d",
    message:
      "Artwork is the only source of colour. There is deliberately no success colour: use the ink ramp, --art, or --warn / --danger (DESIGN.md Colors).",
  },
  {
    pattern: "shadow-(xs|sm|md|lg|xl|2xl)\\b",
    message:
      "Only overlays carry a surface, and they get it from OVERLAY_SURFACE. Elsewhere the lift is a hairline (DESIGN.md Elevation & Depth).",
  },
  {
    pattern: "#[0-9a-fA-F]{3,8}\\b",
    message:
      "Colour literals bypass the token layer. Read the spine (--ink, --paper, --rule) or the artwork channel (--art) instead (DESIGN.md Colors, Neutral).",
  },
  {
    pattern:
      "ease-linear|ease-in-out|ease-in|ease-out|ease-\\[|transition-all|duration-[0-9]+|duration-\\[|motion-reduce:|animate-in|animate-out",
    message:
      "Motion has its own curves and durations. Use ease-arrive / ease-leave, the motion-ink / motion-reveal / motion-move / motion-settle utilities, or the `m` component with SPRING / FADE / LEAVE from @workspace/ui/lib/motion (DESIGN.md Motion).",
  },
];

/* Both node types are checked because a class list is as often built inside a
   template literal passed to cn() as it is written as a plain string. */
const restricted = BANNED.flatMap(({ pattern, message }) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
]);

/** @type {import("eslint").Linter.Config} */
export const designTokens = {
  rules: {
    "no-restricted-syntax": ["error", ...restricted],
  },
};
