import { keyedByContent } from "@workspace/ui/lib/keyed";
import type { RulerConfig, RulerMark } from "@workspace/session-diff/ruler";
import { markTitle, positionOf } from "@workspace/ui/lib/ruler-scale";
import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";

/** The ink caret under the baseline, pointing up at the value the block names. */
function Caret({ left }: { left: string }) {
  return (
    <i
      aria-hidden="true"
      className="absolute top-full h-[5px] w-[7px] -translate-x-1/2 bg-ink [clip-path:polygon(50%_0,100%_100%,0_100%)]"
      style={{ left }}
    />
  );
}

/**
 * A value laid out on a ruler, the way a meter shows it: one tick per
 * measurement in the artwork colour, an optional band across the spread, and
 * an ink caret under the baseline pointing at the value the block names.
 * `LoudnessScale` is this drawing fixed to the loudness domain (−28..0 LUFS,
 * with the viewer's loudness reference); `CollectionTempo` fixes it to
 * 60..200 BPM.
 * Pure markup, so it renders on the server; hover titles stand in for
 * tooltips.
 *
 * `live` is drawn inside the ruler, over the baseline, by a client reader
 * that animates a moving value along the same scale (`LiveLoudnessScale`).
 *
 * `was` is where the caret pointed before a change (a save's old tempo): a
 * faint tick stays there, and the caret travels from it to `pointer` as the
 * scale arrives, so the change reads as a move rather than as two numbers.
 */
export function RulerScale({
  config,
  marks,
  band,
  pointer,
  was,
  label,
  live,
  tone = "paper",
  className,
}: {
  config: RulerConfig;
  marks: RulerMark[];
  /** Quietest and loudest values, drawn as a bar between them. */
  band?: [number, number];
  /** The value the caret points at. */
  pointer?: number;
  /** The value the caret pointed at before; needs `pointer`. */
  was?: number;
  /** What a screen reader hears in place of the drawing. */
  label: string;
  live?: ReactNode;
  /** `art` when the scale sits over an artwork field rather than paper. */
  tone?: "paper" | "art";
  className?: string;
}) {
  const { min, max, stops, reference, referenceTitle, format } = config;
  const position = (value: number) => `${positionOf(value, min, max)}%`;

  return (
    <div role="img" aria-label={label} className={cn("select-none", className)}>
      <div className="relative h-5">
        {reference != null && (
          <i
            aria-hidden="true"
            title={referenceTitle}
            className="absolute inset-y-0 w-px -translate-x-1/2 bg-[repeating-linear-gradient(to_bottom,var(--rule-strong)_0_2px,transparent_2px_4px)]"
            style={{ left: position(reference) }}
          />
        )}
        {/* Under the band, ticks and ruler, so a measurement stays readable
            while the live bar runs across it. */}
        {live}
        {band && (
          <i
            aria-hidden="true"
            className="absolute bottom-0 h-0.5 bg-art/30"
            style={{
              left: position(band[0]),
              width: `calc(${position(band[1])} - ${position(band[0])})`,
            }}
          />
        )}
        {was != null && pointer != null && (
          <i
            title={markTitle(config, { value: was, label: "Before" })}
            className="absolute bottom-0 flex h-2.5 w-2 -translate-x-1/2 justify-center"
            style={{ left: position(was) }}
          >
            <span className="block h-full w-0.5 bg-ink-faint" />
          </i>
        )}
        {keyedByContent(marks, (mark) => `${mark.label}@${mark.value}`).map(
          ({ key, item: mark }) => (
            <i
              key={key}
              title={markTitle(config, mark)}
              className="absolute bottom-0 flex h-2.5 w-2 -translate-x-1/2 justify-center"
              style={{ left: position(mark.value) }}
            >
              <span className="block h-full w-0.5 bg-art" />
            </i>
          )
        )}
        {stops.map((value) => (
          <i
            key={value}
            aria-hidden="true"
            className="absolute bottom-0 h-1 w-px -translate-x-1/2 bg-rule-strong"
            style={{ left: position(value) }}
          />
        ))}
        <i
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 border-t border-rule-strong"
        />
        {pointer != null &&
          (was == null ? (
            <Caret left={position(pointer)} />
          ) : (
            // The travel is a translate of a layer as wide as the ruler, so a
            // percentage of it is a percentage of the ruler.
            <i
              aria-hidden="true"
              className="ruler-caret absolute inset-x-0 top-full block"
              style={
                {
                  "--caret-from": `${positionOf(was, min, max) - positionOf(pointer, min, max)}%`,
                } as CSSProperties
              }
            >
              <Caret left={position(pointer)} />
            </i>
          ))}
      </div>
      <div
        className={cn(
          "relative mt-2 h-3 font-mono text-micro tabular-nums",
          tone === "art" ? "on-art-soft" : "text-ink-soft"
        )}
      >
        {stops.map((value, index) => (
          <span
            key={value}
            title={value === reference ? referenceTitle : undefined}
            className={cn(
              "absolute top-0 leading-none",
              index === stops.length - 1
                ? "-translate-x-full"
                : index > 0 && "-translate-x-1/2"
            )}
            style={{ left: position(value) }}
          >
            {format(value)}
          </span>
        ))}
      </div>
    </div>
  );
}
