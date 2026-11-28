"use client";

import { RACK_LABEL_WIDTH } from "@/components/lab/rack-columns";
import {
  matchEqAvailable,
  matchEqReferenceLabel,
  type MatchEqReference,
} from "@/components/lab/lab-view-model";
import {
  useLabSettings,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import {
  useTrackAudioMeasure,
  useTrackAudioMeasures,
} from "@/components/track-audio/measures";
import { matchEqGains } from "@workspace/dsp/match-eq";
import type { Spectrum } from "@workspace/dsp/spectrum";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useMemo } from "react";

const EXPLAINER =
  "Shapes this version's tone toward the version you pick, using the difference between their average spectra.";

const NONE = "none";

/**
 * Matches this version's tone toward another version of the same track, when
 * one carries a stored spectrum to match against. The gains are recomputed
 * whenever the reference or this version's own spectrum changes — including
 * on mount, so a `matchEq` restored from a previous session gets a curve
 * rather than sitting engaged with none.
 */
export function MatchEq({
  current,
  audios,
}: {
  current: MusicPlayerTrack;
  audios: TrackAudioWithAsset[] | null;
}) {
  const currentAudioId = current.trackAudio?.id ?? null;
  const otherAudios = useMemo(
    () => (audios ?? []).filter((audio) => audio.id !== currentAudioId),
    [audios, currentAudioId]
  );
  const spectra = useTrackAudioMeasures<Spectrum>(
    otherAudios.map((audio) => audio.id),
    "spectrum"
  );
  const mySpectrum = useTrackAudioMeasure<Spectrum>(currentAudioId, "spectrum");

  const references: MatchEqReference[] = otherAudios
    .filter((audio) => spectra.has(audio.id))
    .map((audio) => ({
      audioId: audio.id,
      label: matchEqReferenceLabel(audio),
    }));

  const { auditions } = useLabSettings();
  const { setAudition, setEqCurve } = usePlayerActions();
  const selected = auditions.matchEq?.audioId ?? null;
  // A selection restored from a previous session can name an audio that
  // hasn't carried a stored spectrum into `references` yet — the select
  // falls back to "None" rather than the base-ui default of printing the
  // unmatched value, which would be the raw audio ID.
  const hasSelectedReference = references.some((r) => r.audioId === selected);

  useEffect(() => {
    if (selected == null || !mySpectrum) return;
    const reference = spectra.get(selected);
    if (reference) setEqCurve(matchEqGains(reference, mySpectrum));
  }, [selected, mySpectrum, spectra, setEqCurve]);

  if (!matchEqAvailable(references)) return null;

  function choose(value: string) {
    const audioId = value === NONE ? null : Number(value);
    setAudition({
      matchEq:
        audioId === null
          ? null
          : { audioId, ownerType: current.ownerType, ownerId: current.ownerId },
    });
    if (audioId === null) setEqCurve(null);
  }

  return (
    <div className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              LABEL,
              RACK_LABEL_WIDTH,
              "shrink-0 leading-tight text-ink-soft underline decoration-ink-faint/40 decoration-dotted underline-offset-4"
            )}
          >
            Match EQ to
          </span>
        </TooltipTrigger>
        <TooltipContent>{EXPLAINER}</TooltipContent>
      </Tooltip>
      <Select
        value={hasSelectedReference ? String(selected) : NONE}
        onValueChange={choose}
        // The trigger reads its label from here while the popup (and so every
        // `SelectItem`) is unmounted; without it, it prints the raw value.
        items={[
          { value: NONE, label: "None" },
          ...references.map((reference) => ({
            value: String(reference.audioId),
            label: reference.label,
          })),
        ]}
      >
        <SelectTrigger
          className="w-40 text-micro fine:h-6 coarse:h-11"
          aria-label="Match EQ to reference"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {references.map((reference) => (
            <SelectItem
              key={reference.audioId}
              value={String(reference.audioId)}
            >
              {reference.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
