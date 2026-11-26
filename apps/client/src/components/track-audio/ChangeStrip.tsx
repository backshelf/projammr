"use client";

import {
  changeBarFractions,
  changeSummaryLine,
  type ChangeSummary,
} from "@/components/track-audio/change-strip";
import { StripRow } from "@/components/track-audio/StripRow";

/**
 * The change against a reference version: a per-second cell strip filled in
 * the artwork colour at the change value's own alpha, and a summary line
 * underneath that both states the share changed and links to seek to
 * whichever stretch changed the most.
 *
 * Props-only by design — the change map, the summary and the geometry come
 * in, and nothing here fetches: `MeasureStack` holds the consecutive diff
 * this track page reads, and `CompareChangeStrip` draws the comparison's
 * own pair diff through this same component under its two waveforms.
 */
export function ChangeStrip({
  label = "Change",
  change,
  summary,
  durationSeconds,
  getSeconds,
  onSeek,
}: {
  /** The strip's caption and the name of its seek surface. */
  label?: string;
  change: readonly number[];
  summary: ChangeSummary;
  durationSeconds: number;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
}) {
  const bars = changeBarFractions(change);
  const loudest = summary.loudestChange;

  return (
    // `col-span-2 grid-cols-subgrid` so the caption below inherits the same
    // two columns `StripRow` does — it starts in column 2, at the seek
    // surface's own left edge, rather than a hand-computed label width.
    <div className="col-span-2 grid grid-cols-subgrid">
      <StripRow
        label={label}
        durationSeconds={durationSeconds}
        getSeconds={getSeconds}
        onSeek={onSeek}
      >
        <div className="absolute inset-0 flex">
          {bars.map((fraction, i) => (
            <i
              // eslint-disable-next-line @eslint-react/no-array-index-key -- a cell is its bar's slot on the timeline, not an identity
              key={i}
              className="h-full flex-1 bg-art"
              style={{ opacity: fraction }}
            />
          ))}
        </div>
      </StripRow>
      <p className="col-start-2 text-micro text-ink-faint">
        {loudest ? (
          <button
            type="button"
            className="cursor-pointer text-left motion-ink hover:text-ink focus-visible:text-ink"
            onClick={() => onSeek(loudest.startMs / 1000)}
          >
            {changeSummaryLine(summary)}
          </button>
        ) : (
          changeSummaryLine(summary)
        )}
      </p>
    </div>
  );
}
