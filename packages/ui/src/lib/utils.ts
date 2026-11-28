import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale in globals.css (`--text-micro` … `--text-display`) adds
 * font-size utilities tailwind-merge does not ship with. Left unregistered it
 * reads `text-small` as a *colour* — any unknown `text-*` is assumed to be one
 * — so a real colour beside it looks like a duplicate and the size is dropped,
 * silently leaving the element at the inherited page size.
 *
 * Registering the scale keeps size and colour in their own groups, so
 * `text-small text-ink` survives intact and a later size still overrides an
 * earlier one.
 *
 * The three lifts (`shadow-overlay`, `shadow-menu`, `shadow-float`) are
 * registered for the same reason: an unknown `shadow-*` reads as a shadow
 * colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["overlay", "menu", "float"] }],
      "font-size": [
        {
          text: [
            "micro",
            "small",
            "body",
            "lead",
            "section",
            "subtitle",
            "title",
            "display",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
