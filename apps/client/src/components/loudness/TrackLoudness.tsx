"use client";

import { LoudnessReading } from "@workspace/ui/components/loudness/loudness-reading";
import { LiveLoudnessScale } from "@/components/loudness/LiveLoudnessScale";
import { LoudnessUnit } from "@workspace/ui/components/loudness/loudness-unit";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { useFormat } from "@workspace/ui/components/format-provider";
import { formatTruePeakValue } from "@workspace/ui/lib/loudness";
import { pluralizeCount } from "@workspace/session-diff/format";
import { RailLabel } from "@workspace/ui/components/layout/rail";

/**
 * The loudness of the version being viewed, over every measured version of
 * the track on one scale, so switching versions in the masthead moves the
 * caret and a remaster's jump in level is visible as the gap between ticks.
 * While the track plays, its live level runs along the scale too.
 */
export function TrackLoudness({ trackId }: { trackId: number }) {
  const { audios, selected } = useTrackAudio();
  const format = useFormat();

  const measured = audios.flatMap((audio) =>
    audio.lufs == null
      ? []
      : [{ lufs: audio.lufs, label: `v${audio.version} · ${audio.asset.name}` }]
  );
  const lufs = selected?.lufs ?? null;

  return (
    <div>
      <RailLabel
        action={
          audios.length > 1 ? (
            <span>{pluralizeCount(audios.length, "version")}</span>
          ) : undefined
        }
      >
        LOUDNESS
      </RailLabel>
      {lufs == null ? (
        <div className="text-small text-ink-soft italic">measuring…</div>
      ) : (
        <LoudnessReading lufs={lufs} format={format}>
          <LoudnessUnit unit="LUFS" />
          {selected?.truePeakDb != null && (
            <span className="text-ink-soft">
              <LoudnessUnit unit="TP" />{" "}
              {formatTruePeakValue(selected.truePeakDb)}
            </span>
          )}
        </LoudnessReading>
      )}
      <LiveLoudnessScale
        owner={{ kind: "track", id: trackId }}
        className="mt-3"
        marks={measured}
        pointer={lufs ?? undefined}
        label={
          lufs == null
            ? `Loudness of ${pluralizeCount(measured.length, "version")}`
            : `Loudness ${format.lufs(lufs)} LUFS, across ${pluralizeCount(measured.length, "measured version")}`
        }
      />
    </div>
  );
}
