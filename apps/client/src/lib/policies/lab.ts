/**
 * How the Lab behaves: what a fresh browser's Lab starts with (the time and
 * pitch mode, the rack's compressor, reverb and EQ), how far speed and pitch
 * may go, what a reload remembers, when the Lab lets go, the level
 * `normalise` brings a version to, and how a bounce is written. The
 * defaults are the Lab as it has always behaved, taken from `DEFAULT_LAB`
 * and the Lab's own bounds.
 */

import {
  DEFAULT_LAB,
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
  type CompSettings,
  type LabSettings,
  type ReverbSettings,
  type SpeedPitchMode,
} from "@/lib/dsp/lab-settings";

/** A closed range a Lab control stays inside. */
export type LabRange = { min: number; max: number };

/** What a bounce is encoded as; 24-bit FLAC is the one encoder there is. */
export type BounceFormat = "flac-24";

/** The file extension each bounce format writes. */
export const BOUNCE_EXTENSIONS: Record<BounceFormat, string> = {
  "flac-24": "flac",
};

export type LabPolicy = {
  /** The time and pitch mode a fresh browser's Lab starts in. */
  timePitchMode: SpeedPitchMode;
  /** Where the speed control stops, inside the Lab's own `SPEED_MIN`..`SPEED_MAX`. */
  speedRange: LabRange;
  /** Where the pitch control stops, in semitones, inside `PITCH_MIN`..`PITCH_MAX`. */
  pitchRange: LabRange;
  /**
   * Whether the auditions that are safe to keep (width, crossfeed, the
   * right channel's polarity, normalise, a match EQ) survive a reload. The
   * dangerous ones never do.
   */
  rememberAuditions: boolean;
  /** Whether the Lab, once engaged, stays engaged after its last reason clears. */
  keepEngaged: boolean;
  /** How long the Lab stays engaged after the last reason for it clears. */
  releaseDelayMs: number;
  /** The loudness `normalise` brings a version to, in LUFS. */
  normaliseTargetLufs: number;
  /** The compressor a fresh browser's rack starts with. */
  compressor: CompSettings;
  /** The reverb a fresh browser's rack starts with. */
  reverb: ReverbSettings;
  /** The EQ a fresh browser's rack starts with. */
  eqPreset: LabSettings["rack"]["eq"];
  bounceFormat: BounceFormat;
  /**
   * A bounce's file name before its extension: `{title}` is the track's,
   * `{version}` the version printed ("v3"), `{settings}` every setting away
   * from its default ("0.85×, EQ"), and `{details}` the version and settings
   * together in brackets after a space, or nothing when there are none.
   */
  bounceNameTemplate: string;
};

export const DEFAULT_LAB_POLICY: LabPolicy = {
  timePitchMode: DEFAULT_LAB.mode,
  speedRange: { min: SPEED_MIN, max: SPEED_MAX },
  pitchRange: { min: PITCH_MIN, max: PITCH_MAX },
  rememberAuditions: true,
  keepEngaged: false,
  releaseDelayMs: 2000,
  normaliseTargetLufs: -14,
  compressor: DEFAULT_LAB.rack.comp,
  reverb: DEFAULT_LAB.rack.reverb,
  eqPreset: DEFAULT_LAB.rack.eq,
  bounceFormat: "flac-24",
  bounceNameTemplate: "{title} — Lab bounce{details}",
};

/** The Lab settings a browser with nothing stored starts from under `policy`. */
export function labSettingsFrom(policy: LabPolicy): LabSettings {
  return {
    ...DEFAULT_LAB,
    mode: policy.timePitchMode,
    rack: {
      eq: policy.eqPreset,
      comp: policy.compressor,
      reverb: policy.reverb,
    },
  };
}

/** The normalise audition's name: its target in LUFS, "−14 LUFS". */
export const normaliseLabel = (targetLufs: number) =>
  `${targetLufs < 0 ? `−${-targetLufs}` : targetLufs} LUFS`;

/** `value` held inside `range`. */
export const clampToRange = (value: number, { min, max }: LabRange) =>
  Math.min(max, Math.max(min, value));
