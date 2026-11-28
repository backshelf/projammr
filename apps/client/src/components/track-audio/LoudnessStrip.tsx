"use client";

import {
  loudnessStripFractions,
  loudnessStripReference,
} from "@/components/track-audio/loudness-strip";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { StripRow } from "@/components/track-audio/StripRow";
import {
  areaSegments,
  curveSegments,
} from "@/components/track-audio/strip-curve";
import { useVisualsPolicy } from "@/lib/policies/provider";
import type { ClippedBin } from "@workspace/dsp/offline";
import { formatSeconds } from "@workspace/ui/lib/format";
import { formatLufs, formatSignedDecimal } from "@workspace/ui/lib/loudness";
import { cn } from "@workspace/ui/lib/utils";
import { MAX_BARS } from "@workspace/ui/lib/waveform-bars";
import { useId, useMemo } from "react";

const FIXED_GRID_LUFS = [-6, -24] as const;

/**
 * The short-term loudness curve turned sideways: a vertical `--art` gradient
 * area under a 1.5px stroke on the −28..0 LUFS ruler, with −6 / viewer ref /
 * −24 gridlines, lazily fetched `measures/clipping` top-edge warning/danger
 * ticks, and a `fine:` hover inspector (`1:12 · −8.4 LUFS (+5.6 vs −14)`).
 */
export function LoudnessStrip({
  trackAudioId,
  curve,
  durationSeconds,
  getSeconds,
  onSeek,
}: {
  trackAudioId: number;
  curve: readonly (number | null)[];
  durationSeconds: number;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
}) {
  const { loudnessReferenceLufs } = useVisualsPolicy();
  const clipping = useTrackAudioMeasure<ClippedBin[]>(trackAudioId, "clipping");
  const gradientId = useId();
  const fractions = loudnessStripFractions(curve);
  const referenceY = (1 - loudnessStripReference(loudnessReferenceLufs)) * 100;

  const gridStops = useMemo(() => {
    const stops: { lufs: number; isRef: boolean; y: number }[] = [
      { lufs: loudnessReferenceLufs, isRef: true, y: referenceY },
    ];
    for (const lufs of FIXED_GRID_LUFS) {
      if (Math.abs(lufs - loudnessReferenceLufs) >= 1) {
        stops.push({
          lufs,
          isRef: false,
          y: (1 - loudnessStripReference(lufs)) * 100,
        });
      }
    }
    return stops;
  }, [loudnessReferenceLufs, referenceY]);

  const clipTicks = useMemo(() => {
    if (!clipping || clipping.length === 0 || durationSeconds <= 0) return [];
    const seen = new Map<number, "danger" | "warn">();
    for (const bin of clipping) {
      if (!bin.over && bin.samples < 3) continue;
      const pct = Math.min(
        100,
        Math.max(0, ((bin.binIndex * 0.05) / durationSeconds) * 100)
      );
      const bucket = Math.round(pct * 2); // 0.5% spatial bucket
      const severity = bin.samples >= 3 ? "danger" : "warn";
      const prev = seen.get(bucket);
      if (prev !== "danger") seen.set(bucket, severity);
    }
    return Array.from(seen.entries()).map(([bucket, severity]) => ({
      pct: bucket / 2,
      severity,
    }));
  }, [clipping, durationSeconds]);

  return (
    <StripRow
      label="Loudness"
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
      className="h-14 phone:h-12"
      renderHoverReadout={(hover) => {
        const time = formatSeconds(hover.seconds);
        if (curve.length === 0) return time;
        const idx = Math.min(
          curve.length - 1,
          Math.max(0, Math.floor(hover.ratio * curve.length))
        );
        const lufs = curve[idx];
        if (lufs == null) return `${time} · gated`;
        const delta = formatSignedDecimal(lufs - loudnessReferenceLufs);
        const refText = Number.isInteger(loudnessReferenceLufs)
          ? `−${Math.abs(loudnessReferenceLufs)}`
          : formatLufs(loudnessReferenceLufs);
        return `${time} · ${formatLufs(lufs)} LUFS (${delta} vs ${refText})`;
      }}
    >
      <svg
        viewBox={`0 0 ${MAX_BARS} 100`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--art)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--art)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        {gridStops.map((stop) => (
          <line
            key={`${stop.lufs}-${stop.isRef ? "ref" : "grid"}`}
            x1={0}
            x2={MAX_BARS}
            y1={stop.y}
            y2={stop.y}
            className={stop.isRef ? "stroke-rule-strong" : "stroke-rule"}
            strokeWidth={1}
            strokeDasharray={stop.isRef ? "2 2" : undefined}
            strokeOpacity={stop.isRef ? 1 : 0.65}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {areaSegments(fractions).map((d, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- one path per contiguous run of measured seconds, not a keyed list
          <path key={i} d={d} fill={`url(#${gradientId})`} />
        ))}
        {curveSegments(fractions).map((d, i) => (
          <path
            // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
            key={i}
            d={d}
            fill="none"
            className="stroke-ink"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-1 select-none"
      >
        {gridStops.map((stop) => (
          <span
            key={stop.lufs}
            className="absolute right-0 -translate-y-1/2 text-micro/none text-ink-faint tabular-nums"
            style={{ top: `${Math.min(90, Math.max(10, stop.y))}%` }}
          >
            {Number.isInteger(stop.lufs)
              ? stop.lufs === 0
                ? "0"
                : `−${Math.abs(stop.lufs)}`
              : formatLufs(stop.lufs)}
          </span>
        ))}
      </div>
      {clipTicks.map((tick) => (
        <span
          key={tick.pct}
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-0 h-1.5 w-[2px] -translate-x-1/2",
            tick.severity === "danger" ? "bg-danger" : "bg-warn"
          )}
          style={{ left: `${tick.pct}%` }}
        />
      ))}
    </StripRow>
  );
}
