"use client";

import { LiveSpectrumScale } from "@/components/spectrum/LiveSpectrumScale";
import type { SpectrumCurve } from "@/components/spectrum/SpectrumScale";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { useTrackAudioMeasures } from "@/components/track-audio/measures";
import { pluralizeCount } from "@workspace/session-diff/format";
import { spectrumWindow, type Spectrum } from "@workspace/dsp/spectrum";
import { RailLabel } from "@workspace/ui/components/layout/rail";

/**
 * The spectral balance of the version being viewed, over every measured
 * version of the track on one window, so switching versions in the masthead
 * brings its curve forward and a remaster's brighter top reads as the gap
 * between two lines. While the track plays, its live spectrum runs over them.
 */
export function TrackSpectrum({ trackId }: { trackId: number }) {
  const { audios, selected } = useTrackAudio();
  const spectra = useTrackAudioMeasures<Spectrum>(
    audios.map((audio) => audio.id),
    "spectrum"
  );

  const curves = audios.flatMap((audio): SpectrumCurve[] => {
    const curve = spectra.get(audio.id);
    return curve
      ? [
          {
            ...curve,
            label: `v${audio.version} · ${audio.asset.name}`,
            emphasis: audio.id === selected?.id ? "selected" : "other",
          },
        ]
      : [];
  });

  const measuring = selected != null && !spectra.has(selected.id);

  return (
    <div>
      <RailLabel
        action={
          audios.length > 1 ? (
            <span>{pluralizeCount(audios.length, "version")}</span>
          ) : undefined
        }
      >
        SPECTRUM
      </RailLabel>
      {measuring && (
        <div className="text-small text-ink-soft italic">measuring…</div>
      )}
      <LiveSpectrumScale
        owner={{ kind: "track", id: trackId }}
        className="mt-3"
        curves={curves}
        window={spectrumWindow(curves.map((curve) => curve.db))}
        label={`Spectrum of ${pluralizeCount(curves.length, "measured version")}`}
      />
    </div>
  );
}
