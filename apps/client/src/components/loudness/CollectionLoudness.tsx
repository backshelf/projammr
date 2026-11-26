import { LoudnessReading } from "@workspace/ui/components/loudness/loudness-reading";
import { LiveLoudnessScale } from "@/components/loudness/LiveLoudnessScale";
import { LoudnessUnit } from "@workspace/ui/components/loudness/loudness-unit";
import { loudnessMeasuredLabel } from "@workspace/ui/lib/loudness";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { Formatters } from "@workspace/ui/lib/formatters";
import type { CollectionLoudness as CollectionLoudnessSummary } from "@workspace/api/api";
import { RailLabel } from "@workspace/ui/components/layout/rail";

/**
 * How loud a collection's tracks are relative to each other: the median as
 * the reading, and every measured track on one scale so an outlier stands
 * out as a tick away from the pack. Reads as partial until every track with
 * audio has been measured. While one of its tracks plays, that track's live
 * level runs along the same scale, among its siblings' ticks. The figures are
 * written in the viewer's `format`.
 */
export function CollectionLoudness({
  collectionId,
  loudness,
  format,
}: {
  collectionId: number;
  loudness: NonNullable<CollectionLoudnessSummary>;
  format: Formatters;
}) {
  const pending = loudness.measured < loudness.total;

  return (
    <div>
      <RailLabel
        action={
          <span>
            {loudnessMeasuredLabel(loudness.measured, loudness.total)}
          </span>
        }
      >
        LOUDNESS
      </RailLabel>
      <LoudnessReading lufs={loudness.median} pending={pending} format={format}>
        <span>
          <LoudnessUnit unit="LUFS" /> median
        </span>
        {loudness.measured > 1 && (
          <span className="text-ink-soft">
            {format.lufs(loudness.min)} to {format.lufs(loudness.max)}
          </span>
        )}
      </LoudnessReading>
      <LiveLoudnessScale
        owner={{ kind: "collection", id: collectionId }}
        className="mt-3"
        marks={loudness.tracks.map((track) => ({
          lufs: track.lufs,
          label: track.title,
        }))}
        band={loudness.measured > 1 ? [loudness.min, loudness.max] : undefined}
        pointer={loudness.median}
        label={`Loudness of ${pluralizeCount(loudness.measured, "track")}: median ${format.lufs(loudness.median)} LUFS, from ${format.lufs(loudness.min)} to ${format.lufs(loudness.max)}`}
      />
    </div>
  );
}
