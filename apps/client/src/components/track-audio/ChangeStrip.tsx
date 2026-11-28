"use client";

import {
  changeBarFractions,
  changeHotspots,
  changeSummaryLine,
  formatAlignmentBadge,
  type ChangeSummary,
} from "@/components/track-audio/change-strip";
import { StripRow } from "@/components/track-audio/StripRow";
import { formatSeconds, formatTimecode } from "@workspace/ui/lib/format";
import { formatSignedDecimal } from "@workspace/ui/lib/loudness";
import { useMemo } from "react";

/**
 * The change against a reference version: dual height+opacity bars with a
 * `< 0.15` noise gate, explicit `vs vN` + alignment readout in the eyebrow,
 * top 2–3 hotspot jump chips, and a hover readout including `loudnessDelta`.
 */
export function ChangeStrip({
  label = "Change",
  vsVersion,
  aligned,
  offsetMs,
  change,
  loudnessDelta,
  summary,
  durationSeconds,
  getSeconds,
  onSeek,
  live = false,
}: {
  /** The strip's caption and the name of its seek surface. */
  label?: string;
  vsVersion?: number | null;
  aligned?: boolean;
  offsetMs?: number | null;
  change: readonly number[];
  loudnessDelta?: readonly number[];
  summary: ChangeSummary;
  durationSeconds: number;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
  live?: boolean;
}) {
  const bars = changeBarFractions(change);
  const hotspots = useMemo(() => changeHotspots(change, 3), [change]);
  const alignmentBadge = formatAlignmentBadge(aligned, offsetMs);
  const displayLabel =
    vsVersion != null ? `${label} · vs v${vsVersion}` : label;

  return (
    <StripRow
      label={displayLabel}
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
      live={live}
      className="h-9"
      eyebrow={
        alignmentBadge ? (
          <span className="shrink-0 text-micro text-ink-faint tabular-nums">
            {alignmentBadge}
          </span>
        ) : null
      }
      renderHoverReadout={(hover) => {
        const time = formatSeconds(hover.seconds);
        if (change.length === 0) return time;
        const sec = Math.min(
          change.length - 1,
          Math.max(0, Math.floor(hover.ratio * change.length))
        );
        const pct = Math.round((change[sec] ?? 0) * 100);
        const delta = loudnessDelta?.[sec];
        const deltaText =
          delta != null && Number.isFinite(delta)
            ? ` · ${formatSignedDecimal(delta)} LU`
            : "";
        return `${time} · ${pct}% changed${deltaText}`;
      }}
      footer={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-faint tabular-nums">
          <span>
            {hotspots.length > 0
              ? `${Math.round(summary.changedShare * 100)}% changed`
              : changeSummaryLine(summary)}
          </span>
          {hotspots.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span>Jump:</span>
              {hotspots.map((spot) => (
                <button
                  key={spot.startMs}
                  type="button"
                  onClick={() => onSeek(spot.startMs / 1000)}
                  className="cursor-pointer rounded-sm border border-rule px-1 py-px text-micro text-ink-soft motion-ink hover:border-ink-faint hover:text-ink"
                >
                  {formatTimecode(spot.startMs)}–{formatTimecode(spot.endMs)}
                </button>
              ))}
            </span>
          )}
        </div>
      }
    >
      <div className="pointer-events-none absolute inset-0 flex items-end">
        {bars.map((fraction, i) => (
          <i
            // eslint-disable-next-line @eslint-react/no-array-index-key -- a cell is its bar's slot on the timeline, not an identity
            key={i}
            className="flex-1 bg-art"
            style={{
              height:
                fraction <= 0
                  ? "0%"
                  : `${Math.max(12, Math.round(fraction * 100))}%`,
              opacity: fraction <= 0 ? 0 : 0.25 + 0.75 * fraction,
            }}
          />
        ))}
      </div>
    </StripRow>
  );
}
