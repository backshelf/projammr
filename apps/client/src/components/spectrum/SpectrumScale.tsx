import {
  areaPath,
  curvePath,
  envelopePath,
  hzLabel,
  SPECTRUM_LABELLED,
  SPECTRUM_RULER,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  xOf,
} from "@/components/spectrum/spectrum-geometry";
import { keyedByContent } from "@workspace/ui/lib/keyed";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** How far up from the baseline a ruler tick reaches. */
const TICK_HEIGHT = 4;

const NUMERALS = SPECTRUM_RULER.filter((hz) => SPECTRUM_LABELLED.has(hz));

export type SpectrumCurve = {
  hz: readonly number[];
  db: readonly number[];
  /** Names the curve in its hover title: a version, a track. */
  label: string;
  /** `selected` fills under the curve in the artwork colour; `other` is a faint line behind it. */
  emphasis: "selected" | "other";
};

export type SpectrumBand = {
  hz: readonly number[];
  min: readonly number[];
  max: readonly number[];
};

/**
 * A long-term average spectrum drawn as a curve over a log frequency ruler,
 * 20 Hz to 20 kHz, on a shared dB window so every curve in a block reads
 * against the same scale. The curve under the caret is filled in the artwork
 * colour and its siblings sit behind it as faint ink lines; a collection's
 * spread draws as a band under its mean. Pure markup, so it renders on the
 * server; hover titles stand in for tooltips.
 *
 * The drawing stretches to its container — the viewBox is fixed and the
 * strokes do not scale — so the same markup reads at a rail's width and at
 * the now-playing sheet's.
 *
 * `live` is drawn inside the same `<svg>`, over the stored curves, by a client
 * reader that animates the playing audio's spectrum on the same window
 * (`LiveSpectrumScale`).
 */
/** How tall the drawing stands: `rail` beside a page's content, `tall` where
 *  the drawing is also a control (the Lab's EQ) and a few dB must read. */
export const SPECTRUM_DRAWING_HEIGHT = {
  rail: "h-14",
  tall: "h-28",
} as const;

export type SpectrumSize = keyof typeof SPECTRUM_DRAWING_HEIGHT;

export function SpectrumScale({
  curves,
  envelope,
  window,
  label,
  live,
  tone = "paper",
  size = "rail",
  className,
}: {
  size?: SpectrumSize;
  curves: SpectrumCurve[];
  /** Quietest and loudest level per band, drawn as a band behind the curves. */
  envelope?: SpectrumBand;
  /** Floor and ceiling in dB, from `spectrumWindow`. */
  window: readonly [number, number];
  /** What a screen reader hears in place of the drawing. */
  label: string;
  live?: ReactNode;
  /** `art` when the scale sits over an artwork field rather than paper. */
  tone?: "paper" | "art";
  className?: string;
}) {
  const keyed = keyedByContent(curves, (curve) => curve.label);

  return (
    <div role="img" aria-label={label} className={cn("select-none", className)}>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className={cn(
          "block w-full overflow-visible",
          SPECTRUM_DRAWING_HEIGHT[size]
        )}
      >
        {/* Under the curves, so a measurement stays readable across the ruler. */}
        <g className="stroke-rule-strong" strokeWidth={1}>
          {SPECTRUM_RULER.map((hz) => (
            <line
              key={hz}
              x1={xOf(hz)}
              x2={xOf(hz)}
              y1={VIEW_HEIGHT - TICK_HEIGHT}
              y2={VIEW_HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={VIEW_WIDTH}
            y1={VIEW_HEIGHT}
            y2={VIEW_HEIGHT}
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {envelope && (
          <path
            d={envelopePath(envelope.hz, envelope.min, envelope.max, window)}
            className="fill-art/15"
          />
        )}
        {keyed
          .filter(({ item }) => item.emphasis === "other")
          .map(({ key, item }) => (
            <path
              key={key}
              d={curvePath(item.hz, item.db, window)}
              fill="none"
              strokeWidth={1}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-ink/25"
            >
              <title>{item.label}</title>
            </path>
          ))}
        {keyed
          .filter(({ item }) => item.emphasis === "selected")
          .map(({ key, item }) => (
            <g key={key}>
              <path
                d={areaPath(item.hz, item.db, window)}
                className="fill-art/20"
              />
              <path
                d={curvePath(item.hz, item.db, window)}
                fill="none"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-art"
              >
                <title>{item.label}</title>
              </path>
            </g>
          ))}
        {live}
      </svg>
      <div
        className={cn(
          "relative mt-2 h-3 font-mono text-micro tabular-nums",
          tone === "art" ? "on-art-soft" : "text-ink-soft"
        )}
      >
        {NUMERALS.map((hz, index) => (
          <span
            key={hz}
            className={cn(
              "absolute top-0 leading-none",
              index === NUMERALS.length - 1
                ? "-translate-x-full"
                : index > 0 && "-translate-x-1/2"
            )}
            style={{ left: `${xOf(hz) / 10}%` }}
          >
            {hzLabel(hz)}
          </span>
        ))}
      </div>
    </div>
  );
}
