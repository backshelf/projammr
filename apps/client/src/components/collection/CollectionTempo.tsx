import { RulerScale } from "@workspace/ui/components/loudness/ruler-scale";
import { tempoRuler } from "@workspace/session-diff/ruler";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { Formatters } from "@workspace/ui/lib/formatters";
import type { CollectionTempo as CollectionTempoSummary } from "@workspace/api/api";
import { RailLabel } from "@workspace/ui/components/layout/rail";

/**
 * How fast a collection's tracks run relative to each other: the median as
 * the reading, and every measured track on one scale so an outlier stands
 * out as a tick away from the pack — `CollectionLoudness`'s pattern, run
 * through the tempo domain. The figures are detected tempos and statistics
 * over them, written in the viewer's `format`.
 */
export function CollectionTempo({
  tempo,
  format,
}: {
  tempo: NonNullable<CollectionTempoSummary>;
  format: Formatters;
}) {
  const figure = (bpm: number) =>
    format.tempo(bpm, { unit: false, whole: true });
  const median = figure(tempo.median);
  const range = `${figure(tempo.min)} to ${figure(tempo.max)}`;

  return (
    <div>
      <RailLabel>TEMPO</RailLabel>
      <p className="font-display-clean text-section">
        {median}
        <span className="ml-1 text-micro text-ink-soft">BPM median</span>
      </p>
      {tempo.measured > 1 && (
        <p className="text-micro text-ink-soft">
          {range} BPM across {pluralizeCount(tempo.measured, "track")}
        </p>
      )}
      <RulerScale
        config={tempoRuler(format)}
        marks={tempo.tracks.map((track) => ({
          value: track.bpm,
          label: track.title,
        }))}
        band={tempo.measured > 1 ? [tempo.min, tempo.max] : undefined}
        pointer={tempo.median}
        label={`Tempo of ${pluralizeCount(tempo.measured, "track")}: median ${median} BPM, from ${range}`}
        className="mt-3"
      />
    </div>
  );
}
