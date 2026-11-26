import type { PriorityScaleLevel } from "@workspace/api/api";

/*
 * Priority levels for tests: the scale a new project is seeded with, and a
 * builder for any other. Test-only; nothing in the app imports it.
 */

/* eslint-disable no-restricted-syntax -- a level's colour is user data the server stores as `#rrggbb`, not a class name */
/** The seeded greys, and one colour a user might pick for a level of their own. */
export const LEVEL_COLOURS = {
  soft: "#525252",
  faint: "#898989",
  ink: "#020202",
  picked: "#c2410c",
} as const;
/* eslint-enable no-restricted-syntax */

/** A level of a project's scale; nothing holds it unless `counts` says so. */
export function scaleLevel(
  id: number,
  name: string,
  rank: number,
  options: { colour?: string; isDefault?: boolean } = {}
): PriorityScaleLevel {
  return {
    id,
    name,
    colour: options.colour ?? LEVEL_COLOURS.soft,
    rank,
    isDefault: options.isDefault ?? false,
    counts: { tracks: 0, collections: 0, sessions: 0 },
  };
}

export const NONE = scaleLevel(11, "None", 0, { isDefault: true });
export const LOW = scaleLevel(12, "Low", 1, { colour: LEVEL_COLOURS.faint });
export const MEDIUM = scaleLevel(13, "Medium", 2);
export const HIGH = scaleLevel(14, "High", 3, { colour: LEVEL_COLOURS.ink });
export const URGENT = scaleLevel(15, "Urgent", 4, {
  colour: LEVEL_COLOURS.ink,
});

/** A new project's scale, bottom level first, as the server lists it. */
export const SEEDED_SCALE: PriorityScaleLevel[] = [
  NONE,
  LOW,
  MEDIUM,
  HIGH,
  URGENT,
];
