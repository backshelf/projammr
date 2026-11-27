"use client";

import {
  adoptKeyPatches,
  adoptTempoPatch,
  type AdoptPatch,
} from "@/components/track-audio/adopt-detected";
import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { isActionError } from "@workspace/api/lib/action-result";
import { useFormat } from "@workspace/ui/components/format-provider";
import { keyParts } from "@workspace/session-diff/musical-key";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { RailBlock, RailLabel } from "@workspace/ui/components/layout/rail";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

/** Below this, the estimator's own answer is close to a coin flip — worth
 *  showing, not worth trusting without a look. For tempo it sits between
 *  unpulsed audio, under 0.08, and a loose groove, over 0.2: the bands
 *  `packages/dsp`'s `tempo.rs` tests hold across seeds. */
const LOW_CONFIDENCE_THRESHOLD = 0.1;

/** A fine pointer gets a hover/focus tooltip; a coarse one, which has no
 *  hover, gets the same copy behind a tap — `LoudnessUnit`'s pattern. */
function LowConfidenceMark() {
  const coarse = useCoarsePointer();
  const mark = (
    <abbr tabIndex={0} className="text-ink-faint no-underline">
      ?
    </abbr>
  );

  if (coarse) {
    return (
      <Popover>
        <PopoverTrigger asChild>{mark}</PopoverTrigger>
        <PopoverContent>Low confidence</PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{mark}</TooltipTrigger>
      <TooltipContent>Low confidence</TooltipContent>
    </Tooltip>
  );
}

/**
 * One rail cell: the track's own value when it has one, otherwise the
 * primary version's detected value in faint ink with a `detected` hint, a
 * `?` under {@link LOW_CONFIDENCE_THRESHOLD}, and — where the track has a
 * main session to write it to — an `Adopt` action.
 */
function DetectedField({
  label,
  ownValue,
  detectedValue,
  confidence,
  patches,
  tabular,
}: {
  label: string;
  ownValue: string | null;
  detectedValue: string | null;
  confidence: number | null;
  /** The patches `Adopt` sends, or null when there is nowhere to write them
   *  (no main session) or nothing valid to adopt. */
  patches: AdoptPatch[] | null;
  tabular?: boolean;
}) {
  const mutate = useMutate();
  const [adopting, setAdopting] = useState(false);

  if (ownValue) {
    return (
      <div>
        <RailLabel>{label}</RailLabel>
        <MetadataItem>
          {tabular ? (
            <span className="tabular-nums">{ownValue}</span>
          ) : (
            ownValue
          )}
        </MetadataItem>
      </div>
    );
  }

  if (!detectedValue) {
    return (
      <div>
        <RailLabel>{label}</RailLabel>
        <MetadataItem>{null}</MetadataItem>
      </div>
    );
  }

  const lowConfidence =
    confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD;

  const adopt = async () => {
    const first = patches?.[0];
    if (!first) return;
    setAdopting(true);
    const body = Object.fromEntries(patches.map((p) => [p.fieldName, p.value]));
    const result = await mutate(
      patchEntityFields(first.entityType, first.entityId, body)
    );
    if (isActionError(result)) {
      toast.error(
        `Couldn't adopt the detected ${label.toLowerCase()}: ${result.error}`
      );
      setAdopting(false);
      return;
    }
    setAdopting(false);
  };

  return (
    <div>
      <RailLabel>{label}</RailLabel>
      {/* Adopting settles the value into ink as it becomes the track's own,
          and the detection's marks fade out, before the refresh swaps in the
          stored field in the same ink. */}
      <p
        data-adopting={adopting ? "" : undefined}
        className="group/adopt flex items-baseline gap-1.5 text-small"
      >
        <span
          className={cn(
            "text-ink-faint motion-settle group-data-adopting/adopt:text-ink",
            tabular && "tabular-nums"
          )}
        >
          {detectedValue}
        </span>
        <span className="flex items-baseline gap-1.5 motion-settle group-data-adopting/adopt:opacity-0">
          {lowConfidence && <LowConfidenceMark />}
          <span className="text-micro text-ink-faint">detected</span>
          {patches && (
            <button
              type="button"
              disabled={adopting}
              onClick={adopt}
              className="cursor-pointer text-micro text-art hover:underline focus-visible:underline disabled:pointer-events-none"
            >
              Adopt
            </button>
          )}
        </span>
      </p>
    </div>
  );
}

/**
 * The rail's KEY · BPM block: the track's own fields when they have values —
 * derived from its main session, `deriveTrackMusicMeta` — else the primary
 * version's detection, with a one-click way to write it back onto that
 * session so it becomes the track's own answer. Both are written in the
 * viewer's key notation and tempo display; `Adopt` writes the detection as
 * the estimator spelt it.
 */
export function DetectedMeta({
  ownKey,
  ownBpm,
  detectedKey,
  keyConfidence,
  detectedBpm,
  bpmConfidence,
  mainSessionId,
}: {
  /** The two halves of the track's own key, `keyTonic`/`keyScale`. */
  ownKey: { tonic: string | null; scale: string | null };
  ownBpm: string | null;
  detectedKey: string | null;
  keyConfidence: number | null;
  detectedBpm: number | null;
  bpmConfidence: number | null;
  /** The track's main session, wherever `Adopt` writes to; null leaves the
   *  detected value informational, since there is nowhere to store it. */
  mainSessionId: number | null;
}) {
  const format = useFormat();
  const detected = detectedKey ? keyParts(detectedKey) : null;

  return (
    <RailBlock grid>
      <DetectedField
        label="KEY"
        ownValue={format.key(ownKey.tonic, ownKey.scale)}
        detectedValue={detected && format.key(detected.tonic, detected.scale)}
        confidence={keyConfidence}
        patches={
          mainSessionId != null && detectedKey
            ? adoptKeyPatches(mainSessionId, detectedKey)
            : null
        }
      />
      <DetectedField
        label="BPM"
        ownValue={ownBpm && format.tempo(ownBpm)}
        detectedValue={detectedBpm != null ? format.tempo(detectedBpm) : null}
        confidence={bpmConfidence}
        tabular
        patches={
          mainSessionId != null && detectedBpm != null
            ? [adoptTempoPatch(mainSessionId, detectedBpm)]
            : null
        }
      />
    </RailBlock>
  );
}
