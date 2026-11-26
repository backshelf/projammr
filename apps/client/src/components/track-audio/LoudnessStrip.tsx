"use client";

import {
  loudnessStripFractions,
  loudnessStripReference,
} from "@/components/track-audio/loudness-strip";
import { StripRow } from "@/components/track-audio/StripRow";
import {
  areaSegments,
  curveSegments,
} from "@/components/track-audio/strip-curve";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { MAX_BARS } from "@workspace/ui/lib/waveform-bars";

/**
 * The short-term loudness curve turned sideways: an `art/20` area under a 1px
 * ink line on the same −28..0 LUFS ruler `LoudnessScale` draws, with the
 * viewer's loudness reference as a dotted hairline.
 */
export function LoudnessStrip({
  curve,
  durationSeconds,
  getSeconds,
  onSeek,
}: {
  curve: readonly (number | null)[];
  durationSeconds: number;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
}) {
  const { loudnessReferenceLufs } = useVisualsPolicy();
  const fractions = loudnessStripFractions(curve);
  const referenceY = (1 - loudnessStripReference(loudnessReferenceLufs)) * 100;

  return (
    <StripRow
      label="Loudness"
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
    >
      <svg
        viewBox={`0 0 ${MAX_BARS} 100`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        aria-hidden
      >
        <line
          x1={0}
          x2={MAX_BARS}
          y1={referenceY}
          y2={referenceY}
          className="stroke-rule-strong"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        {areaSegments(fractions).map((d, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- one path per contiguous run of measured seconds, not a keyed list
          <path key={i} d={d} className="fill-art/20" />
        ))}
        {curveSegments(fractions).map((d, i) => (
          <path
            // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
            key={i}
            d={d}
            fill="none"
            className="stroke-ink"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </StripRow>
  );
}
