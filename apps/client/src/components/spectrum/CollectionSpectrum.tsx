import { LiveSpectrumScale } from "@/components/spectrum/LiveSpectrumScale";
import { loudnessMeasuredLabel } from "@workspace/ui/lib/loudness";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { CollectionSpectrum as CollectionSpectrumSummary } from "@workspace/api/api";
import { spectrumWindow } from "@workspace/dsp/spectrum";
import { RailLabel } from "@workspace/ui/components/layout/rail";

/**
 * How a collection's tracks are balanced against each other: the mean curve
 * of every measured track inside the band its quietest and loudest tracks
 * describe, so a track that is dull or harsh against the rest shows as a
 * wide spread rather than a number. Reads as partial until every track with
 * audio has been measured. While one of its tracks plays, that track's live
 * spectrum runs over the mean.
 */
export function CollectionSpectrum({
  collectionId,
  spectrum,
}: {
  collectionId: number;
  spectrum: NonNullable<CollectionSpectrumSummary>;
}) {
  const curves = [
    {
      hz: spectrum.hz,
      db: spectrum.mean,
      label: `Mean of ${pluralizeCount(spectrum.measured, "track")}`,
      emphasis: "selected" as const,
    },
  ];

  return (
    <div>
      <RailLabel
        action={
          <span>
            {loudnessMeasuredLabel(spectrum.measured, spectrum.total)}
          </span>
        }
      >
        SPECTRUM
      </RailLabel>
      <LiveSpectrumScale
        owner={{ kind: "collection", id: collectionId }}
        className="mt-3"
        curves={curves}
        envelope={
          spectrum.measured > 1
            ? { hz: spectrum.hz, min: spectrum.min, max: spectrum.max }
            : undefined
        }
        window={spectrumWindow([spectrum.max])}
        label={`Spectrum of ${pluralizeCount(spectrum.measured, "track")}: the mean curve inside the spread between them`}
      />
    </div>
  );
}
