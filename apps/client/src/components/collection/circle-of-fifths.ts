import {
  CIRCLE_OF_FIFTHS_MAJORS,
  circleOfFifthsPosition,
  type KeyNotation,
  parseMusicalKey,
  spokeLabel,
} from "@workspace/session-diff/musical-key";

export type CircleLayout = {
  cx: number;
  cy: number;
  /** Major keys' ring. */
  outerR: number;
  /** Minor keys' ring. */
  innerR: number;
  /** Where the twelve tonic labels sit, outside both rings. */
  labelR: number;
};

export const DEFAULT_CIRCLE_LAYOUT: CircleLayout = {
  cx: 50,
  cy: 50,
  outerR: 36,
  innerR: 23,
  labelR: 46,
};

/** Spoke `index`'s angle, in radians, with 0 (C) at twelve o'clock and the
 *  rest running clockwise a fifth apart. */
function spokeAngle(index: number): number {
  return (index / 12) * 2 * Math.PI - Math.PI / 2;
}

/** Where spoke `index` lands at `radius` from the circle's centre. */
export function pointOnCircle(
  index: number,
  radius: number,
  layout: CircleLayout = DEFAULT_CIRCLE_LAYOUT
): { x: number; y: number } {
  const angle = spokeAngle(index);
  return {
    x: layout.cx + radius * Math.cos(angle),
    y: layout.cy + radius * Math.sin(angle),
  };
}

/** The unit tangent at spoke `index` — perpendicular to the spoke, the
 *  direction dots sharing that spoke fan out along so they stay near their
 *  key without landing on exactly the same point. */
function tangentAt(index: number): { x: number; y: number } {
  const angle = spokeAngle(index);
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

/** How far apart, in SVG units, two dots fanned out on the same spoke sit. */
const DOT_SPACING = 3.5;

/**
 * The widest a key's cluster may spread, as a share of the arc between two
 * neighbouring spokes on its ring: its outermost dot stays nearer its own
 * spoke than the next one, and inside the drawing. A crowded key packs its
 * dots closer instead of spreading further.
 */
const MAX_SPAN_OF_SPOKE_GAP = 0.4;

export type KeyDot = {
  x: number;
  y: number;
  ring: "outer" | "inner";
  trackId: number;
  title: string;
  /** The detected key as stored, for the dot's note ("A minor"). */
  key: string;
};

/**
 * One dot per track with a placeable key: major on the outer ring, minor on
 * the inner one, both at the spoke their tonic (or, for a minor key, its
 * relative major) shares. A track whose key the circle does not recognise
 * (should never happen — the estimator only ever names the twelve pitch
 * classes) contributes no dot rather than crashing the drawing.
 *
 * Tracks that land on the same spoke and ring — the same key — are fanned
 * out along the spoke's tangent rather than stacked on one point, so a
 * hover or a keyboard focus can still single each of them out; the cluster
 * still reads as "mostly here" at a glance.
 */
export function keyDots(
  tracks: readonly { id: number; title: string; key: string }[],
  layout: CircleLayout = DEFAULT_CIRCLE_LAYOUT
): KeyDot[] {
  const placed = tracks.flatMap((track) => {
    const parsed = parseMusicalKey(track.key);
    const position = parsed && circleOfFifthsPosition(parsed);
    return position
      ? [
          {
            trackId: track.id,
            title: track.title,
            key: track.key,
            ...position,
          },
        ]
      : [];
  });

  const bySpoke = new Map<string, typeof placed>();
  for (const item of placed) {
    const spokeKey = `${item.ring}-${item.index}`;
    const group = bySpoke.get(spokeKey);
    if (group) group.push(item);
    else bySpoke.set(spokeKey, [item]);
  }

  return [...bySpoke.values()].flatMap((group) => {
    const tangent = tangentAt(group[0]!.index);
    const radius = group[0]!.ring === "outer" ? layout.outerR : layout.innerR;
    const point = pointOnCircle(group[0]!.index, radius, layout);
    const spokeGap = (2 * Math.PI * radius) / 12;
    const spacing =
      group.length > 1
        ? Math.min(
            DOT_SPACING,
            (MAX_SPAN_OF_SPOKE_GAP * spokeGap) / (group.length - 1)
          )
        : 0;
    return group.map((item, i) => {
      const offset = (i - (group.length - 1) / 2) * spacing;
      return {
        x: point.x + tangent.x * offset,
        y: point.y + tangent.y * offset,
        ring: item.ring,
        trackId: item.trackId,
        title: item.title,
        key: item.key,
      };
    });
  });
}

export type KeyLabel = { x: number; y: number; label: string };

/** The circle's twelve major-key labels in `notation`, evenly spaced around
 *  `labelR`. */
export function keyLabels(
  notation: KeyNotation,
  layout: CircleLayout = DEFAULT_CIRCLE_LAYOUT
): KeyLabel[] {
  return CIRCLE_OF_FIFTHS_MAJORS.map((_, index) => ({
    ...pointOnCircle(index, layout.labelR, layout),
    label: spokeLabel(index, notation),
  }));
}

/** One beat at `bpm`, in seconds, for the playing dot's pulse; tempos outside
 *  a playable range are held to it rather than strobing or crawling. */
export function beatSeconds(bpm: number): number {
  const held = Math.min(220, Math.max(40, Number.isFinite(bpm) ? bpm : 120));
  return 60 / held;
}
