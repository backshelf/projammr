"use client";

import { InlineEditActions } from "@/components/editing/InlineEditActions";
import {
  adoptKeyPatches,
  adoptTempoPatch,
  type AdoptPatch,
} from "@/components/track-audio/adopt-detected";
import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconPencil } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Input } from "@workspace/ui/components/input";
import { keyParts } from "@workspace/session-diff/musical-key";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { RailBlock, RailLabel } from "@workspace/ui/components/layout/rail";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  ResponsivePicker,
  type ResponsivePickerOption,
} from "@workspace/ui/components/responsive-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const KEY_TONICS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const KEY_SCALES = ["Major", "Minor"] as const;

function canonicalKeyValue(
  tonic: string | null,
  scale: string | null
): string | undefined {
  if (!tonic || !scale) return undefined;
  const cleanTonic = tonic.replace("♯", "#");
  const lower = scale.toLowerCase();
  const cleanScale =
    lower === "major" ? "Major" : lower === "minor" ? "Minor" : scale;
  return `${cleanTonic}|${cleanScale}`;
}

/** Below this, the estimator's own answer is close to a coin flip — worth
 *  showing, not worth trusting without a look. For tempo it sits between
 *  unpulsed audio, under 0.08, and a loose groove, over 0.2: the bands
 *  `packages/dsp`'s `tempo.rs` tests hold across seeds. */
const LOW_CONFIDENCE_THRESHOLD = 0.1;

/** A fine pointer gets a hover/focus tooltip; a coarse one, which has no
 *  hover, gets the same copy behind a tap — `LoudnessUnit`'s pattern. */
function LowConfidenceMark() {
  const coarse = useCoarsePointer();

  if (coarse) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Low confidence"
            className="inline-flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-ink-faint coarse:min-h-11 coarse:min-w-6"
          >
            <span aria-hidden>?</span>
          </button>
        </PopoverTrigger>
        <PopoverContent>Low confidence</PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <abbr tabIndex={0} className="text-ink-faint no-underline">
          ?
        </abbr>
      </TooltipTrigger>
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
 * session so it becomes the track's own answer. Editors with a main session
 * can also pick any key or enter a BPM directly against that session.
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
  /** The track's main session, wherever edits and `Adopt` write to; null
   *  leaves the field informational, since `tracks` has no key/BPM columns. */
  mainSessionId: number | null;
}) {
  const format = useFormat();
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  const detected = detectedKey ? keyParts(detectedKey) : null;
  const editableSessionId = canEdit ? mainSessionId : null;

  return (
    <RailBlock grid>
      <KeyField
        ownKey={ownKey}
        ownValue={format.key(ownKey.tonic, ownKey.scale)}
        detectedValue={detected && format.key(detected.tonic, detected.scale)}
        confidence={keyConfidence}
        patches={
          editableSessionId != null && detectedKey
            ? adoptKeyPatches(editableSessionId, detectedKey)
            : null
        }
        sessionId={editableSessionId}
      />
      <BpmField
        ownBpm={ownBpm}
        ownValue={ownBpm && format.tempo(ownBpm)}
        detectedValue={detectedBpm != null ? format.tempo(detectedBpm) : null}
        confidence={bpmConfidence}
        patches={
          editableSessionId != null && detectedBpm != null
            ? [adoptTempoPatch(editableSessionId, detectedBpm)]
            : null
        }
        sessionId={editableSessionId}
      />
    </RailBlock>
  );
}

function KeyField({
  ownKey,
  ownValue,
  detectedValue,
  confidence,
  patches,
  sessionId,
}: {
  ownKey: { tonic: string | null; scale: string | null };
  ownValue: string | null;
  detectedValue: string | null;
  confidence: number | null;
  patches: AdoptPatch[] | null;
  sessionId: number | null;
}) {
  const format = useFormat();
  const mutate = useMutate();
  const [saving, setSaving] = useState(false);
  const [adopting, setAdopting] = useState(false);

  const keyOptions = useMemo<ResponsivePickerOption[]>(
    () =>
      KEY_TONICS.flatMap((tonic) =>
        KEY_SCALES.map((scale) => {
          const formatted = format.key(tonic, scale) ?? `${tonic} ${scale}`;
          return {
            value: `${tonic}|${scale}`,
            label: formatted,
            searchText: `${formatted} ${tonic} ${scale}`,
          };
        })
      ),
    [format]
  );

  if (sessionId == null) {
    return (
      <DetectedField
        label="KEY"
        ownValue={ownValue}
        detectedValue={detectedValue}
        confidence={confidence}
        patches={patches}
      />
    );
  }

  const currentValue = canonicalKeyValue(ownKey.tonic, ownKey.scale);

  const selectKey = async (encoded: string) => {
    const [rootNote, scale] = encoded.split("|");
    if (!rootNote || !scale) return;
    setSaving(true);
    const result = await mutate(
      patchEntityFields("session", sessionId, { rootNote, scale })
    );
    setSaving(false);
    if (isActionError(result)) {
      toast.error(`Couldn't update key: ${result.error}`);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    const result = await mutate(
      patchEntityFields("session", sessionId, { rootNote: null, scale: null })
    );
    setSaving(false);
    if (isActionError(result)) {
      toast.error(`Couldn't clear key: ${result.error}`);
    }
  };

  const adopt = async () => {
    const first = patches?.[0];
    if (!first || !patches) return;
    setAdopting(true);
    const body = Object.fromEntries(patches.map((p) => [p.fieldName, p.value]));
    const result = await mutate(
      patchEntityFields(first.entityType, first.entityId, body)
    );
    setAdopting(false);
    if (isActionError(result)) {
      toast.error(`Couldn't adopt the detected key: ${result.error}`);
    }
  };

  const pickerTrigger = ownValue ? (
    <button
      type="button"
      disabled={saving}
      aria-label={`${ownValue} — Edit key`}
      className={cn(
        "group relative -mx-1 flex w-full items-center justify-between rounded-md px-1 py-0.5 text-left font-mono text-small text-ink-soft motion-ink",
        "hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden",
        "coarse:min-h-11 coarse:pr-6"
      )}
    >
      <span className="truncate">{ownValue}</span>
      <IconPencil
        size={14}
        aria-hidden
        className={cn("shrink-0 text-ink-faint", REVEAL_ON_HOVER)}
      />
    </button>
  ) : detectedValue ? (
    <button
      type="button"
      disabled={saving}
      aria-label="Edit key"
      className="inline-flex size-6 items-center justify-center rounded-sm text-ink-faint hover:text-ink focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden coarse:size-11"
    >
      <IconPencil size={13} aria-hidden />
    </button>
  ) : (
    <button
      type="button"
      disabled={saving}
      aria-label="Add key — Edit key"
      className={cn(
        "-mx-1 w-full rounded-md px-1 py-0.5 text-left font-mono text-small text-ink-faint italic motion-ink",
        "hover:bg-ink/4 hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden",
        "coarse:min-h-11"
      )}
    >
      Add key
    </button>
  );

  const picker = (
    <ResponsivePicker
      title="Key"
      options={keyOptions}
      value={currentValue}
      onSelect={(val) => void selectKey(val)}
      searchable
      searchPlaceholder="Search key…"
      showClear={Boolean(ownKey.tonic || ownKey.scale)}
      clearLabel="Clear key"
      onClear={() => void clearKey()}
      trigger={pickerTrigger}
    />
  );

  if (!ownValue && detectedValue) {
    const lowConfidence =
      confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD;
    return (
      <div>
        <RailLabel>KEY</RailLabel>
        <div
          data-adopting={adopting ? "" : undefined}
          className="group/adopt flex flex-wrap items-baseline gap-1.5 text-small"
        >
          <span className="text-ink-faint motion-settle group-data-adopting/adopt:text-ink">
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
            {picker}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <RailLabel>KEY</RailLabel>
      {picker}
    </div>
  );
}

function BpmField({
  ownBpm,
  ownValue,
  detectedValue,
  confidence,
  patches,
  sessionId,
}: {
  ownBpm: string | null;
  ownValue: string | null;
  detectedValue: string | null;
  confidence: number | null;
  patches: AdoptPatch[] | null;
  sessionId: number | null;
}) {
  const isMobile = useIsMobile();
  const mutate = useMutate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ownBpm ?? "");
  const [saving, setSaving] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sessionId == null) {
    return (
      <DetectedField
        label="BPM"
        ownValue={ownValue}
        detectedValue={detectedValue}
        confidence={confidence}
        patches={patches}
        tabular
      />
    );
  }

  const begin = () => {
    setDraft(ownBpm ?? "");
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(ownBpm ?? "");
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    const trimmed = draft.trim();
    let nextTempo: string | null = null;
    if (trimmed !== "") {
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num <= 0 || num > 999) {
        setError("Enter a valid BPM");
        return;
      }
      nextTempo = String(num);
    }

    setSaving(true);
    const result = await mutate(
      patchEntityFields("session", sessionId, { tempo: nextTempo })
    );
    setSaving(false);
    if (isActionError(result)) {
      setError(result.error);
      return;
    }
    setEditing(false);
    setError(null);
  };

  const adopt = async () => {
    const first = patches?.[0];
    if (!first || !patches) return;
    setAdopting(true);
    const body = Object.fromEntries(patches.map((p) => [p.fieldName, p.value]));
    const result = await mutate(
      patchEntityFields(first.entityType, first.entityId, body)
    );
    setAdopting(false);
    if (isActionError(result)) {
      toast.error(`Couldn't adopt the detected bpm: ${result.error}`);
    }
  };

  if (editing) {
    return (
      <div>
        <RailLabel>BPM</RailLabel>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            max={999}
            step="any"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                cancel();
              }
            }}
            aria-label="BPM"
            aria-invalid={error != null}
            className="w-full tabular-nums md:text-small fine:h-6 coarse:h-11"
            autoFocus={!isMobile}
          />
          <InlineEditActions
            label="BPM"
            onConfirm={() => void save()}
            onCancel={cancel}
            disabled={saving}
          />
        </div>
        {error && (
          <p role="alert" className="mt-1 text-micro text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!ownValue && detectedValue) {
    const lowConfidence =
      confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD;
    return (
      <div>
        <RailLabel>BPM</RailLabel>
        <div
          data-adopting={adopting ? "" : undefined}
          className="group/adopt flex flex-wrap items-baseline gap-1.5 text-small"
        >
          <span className="text-ink-faint tabular-nums motion-settle group-data-adopting/adopt:text-ink">
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
            <button
              type="button"
              onClick={begin}
              aria-label="Edit BPM"
              className="inline-flex size-6 items-center justify-center rounded-sm text-ink-faint hover:text-ink focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden coarse:size-11"
            >
              <IconPencil size={13} aria-hidden />
            </button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <RailLabel>BPM</RailLabel>
      <button
        type="button"
        onClick={begin}
        aria-label={`${ownValue ?? "Add BPM"} — Edit BPM`}
        className={cn(
          "group relative -mx-1 flex w-full items-center justify-between rounded-md px-1 py-0.5 text-left font-mono text-small motion-ink",
          "hover:bg-ink/4 focus-visible:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden",
          "coarse:min-h-11 coarse:pr-6",
          ownValue
            ? "text-ink-soft tabular-nums hover:text-ink"
            : "text-ink-faint italic hover:text-ink-soft"
        )}
      >
        <span className="truncate">{ownValue ?? "Add BPM"}</span>
        <IconPencil
          size={14}
          aria-hidden
          className={cn("shrink-0 text-ink-faint", REVEAL_ON_HOVER)}
        />
      </button>
    </div>
  );
}
