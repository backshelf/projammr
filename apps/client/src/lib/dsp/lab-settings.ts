/**
 * What the Lab plays with: the listener's settings, their defaults, the rule
 * that decides whether the Lab has to be engaged, and their translation into
 * the chain's parameters. Defaults come from the generated parameter table
 * (`@workspace/dsp/params`), so a default changed in Rust changes here too.
 */

import {
  Block,
  Device,
  FilterKind,
  Param,
  PARAMS,
  Preset,
  StereoMode,
  TimeMode,
  type BlockId,
  type ParamId,
} from "@workspace/dsp/params";
import type { MusicPlayerOwnerType } from "@/components/music-player/types";

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.01;

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

/**
 * What `normalise` reads: the playing version's stored integrated loudness
 * (null without one, when it changes nothing) and the level it brings the
 * version to, the Lab policy's normalise target.
 */
export type LabLoudness = { lufs: number | null; targetLufs: number };

const TIME_MODES = {
  speed: TimeMode.Speed,
  pitch: TimeMode.Pitch,
  linked: TimeMode.Linked,
  independent: TimeMode.Independent,
} as const;
export type SpeedPitchMode = keyof typeof TIME_MODES;

const FILTERS = {
  off: FilterKind.Off,
  peaking: FilterKind.Peaking,
  lowShelf: FilterKind.LowShelf,
  highShelf: FilterKind.HighShelf,
  lowPass: FilterKind.LowPass,
  highPass: FilterKind.HighPass,
} as const;
export type EqFilter = keyof typeof FILTERS;

const PRESETS = {
  booth: Preset.Booth,
  room: Preset.Room,
  hall: Preset.Hall,
  club: Preset.Club,
} as const;
export type ReverbPreset = keyof typeof PRESETS;

/** Whether `name` is an EQ band filter the chain knows. */
export const isEqFilter = (name: string): name is EqFilter =>
  Object.hasOwn(FILTERS, name);

/** Whether `name` is a reverb preset the chain knows. */
export const isReverbPreset = (name: string): name is ReverbPreset =>
  Object.hasOwn(PRESETS, name);

const STEREO_MODES = {
  stereo: StereoMode.Stereo,
  mono: StereoMode.Mono,
  mid: StereoMode.Mid,
  side: StereoMode.Side,
  left: StereoMode.Left,
  right: StereoMode.Right,
} as const;
export type StereoAudition = keyof typeof STEREO_MODES;

const DEVICES = {
  phone: Device.Phone,
  laptop: Device.Laptop,
  earbuds: Device.Earbuds,
  car: Device.Car,
  club: Device.Club,
  radio: Device.Radio,
} as const;
export type DeviceKey = keyof typeof DEVICES;

const BANDS = {
  low: Param.BandLowSolo,
  lowMid: Param.BandLowMidSolo,
  mid: Param.BandMidSolo,
  highMid: Param.BandHighMidSolo,
  air: Param.BandAirSolo,
} as const;
export type BandKey = keyof typeof BANDS;

export type EqBand = { kind: EqFilter; hz: number; gainDb: number; q: number };

export type CompSettings = {
  on: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
};

export type ReverbSettings = {
  on: boolean;
  preset: ReverbPreset;
  wet: number;
  preDelayMs: number;
};

/**
 * The version a match EQ follows, with the track it is a version of: a
 * reference only means something while a version of that same track plays.
 */
export type MatchEqSelection = {
  audioId: number;
  ownerType: MusicPlayerOwnerType;
  ownerId: number;
};

export type Auditions = {
  stereo: StereoAudition;
  width: number;
  polarityRight: boolean;
  crossfeed: boolean;
  /** Soloed bands; empty plays every band. */
  bands: BandKey[];
  device: DeviceKey | null;
  dim: boolean;
  /** Brings the version to the normalise target from its stored loudness. */
  normalise: boolean;
  /** The reference whose spectrum the match EQ follows, or null. */
  matchEq: MatchEqSelection | null;
};

export type LabSettings = {
  mode: SpeedPitchMode;
  speed: number;
  pitch: number;
  rack: {
    eq: { on: boolean; bands: EqBand[] };
    comp: CompSettings;
    reverb: ReverbSettings;
  };
  auditions: Auditions;
};

const paramDefault = (param: ParamId): number => {
  const spec = PARAMS[param]!;
  return spec.kind === "toggle" ? Number(spec.default) : spec.default;
};

function keyFor<K extends string>(map: Record<K, number>, value: number): K {
  return (Object.keys(map) as K[]).find((key) => map[key] === value)!;
}

/** The chain parameters of EQ band `i` (0..7): four to a band, in id order. */
const eqParams = (i: number) => {
  const base = Param.Eq1Kind + i * 4;
  return {
    kind: base as ParamId,
    hz: (base + 1) as ParamId,
    gainDb: (base + 2) as ParamId,
    q: (base + 3) as ParamId,
  };
};

export const EQ_BANDS = 8;

export const DEFAULT_LAB: LabSettings = {
  mode: "speed",
  speed: paramDefault(Param.TimeSpeed),
  pitch: paramDefault(Param.TimePitchSemitones),
  rack: {
    eq: {
      on: false,
      bands: Array.from({ length: EQ_BANDS }, (_, i) => {
        const params = eqParams(i);
        return {
          kind: keyFor(FILTERS, paramDefault(params.kind)),
          hz: paramDefault(params.hz),
          gainDb: paramDefault(params.gainDb),
          q: paramDefault(params.q),
        };
      }),
    },
    comp: {
      on: false,
      thresholdDb: paramDefault(Param.CompThresholdDb),
      ratio: paramDefault(Param.CompRatio),
      attackMs: paramDefault(Param.CompAttackMs),
      releaseMs: paramDefault(Param.CompReleaseMs),
      makeupDb: paramDefault(Param.CompMakeupDb),
    },
    reverb: {
      on: false,
      preset: keyFor(PRESETS, paramDefault(Param.ReverbPreset)),
      wet: paramDefault(Param.ReverbWet),
      preDelayMs: paramDefault(Param.ReverbPreDelayMs),
    },
  },
  auditions: {
    stereo: keyFor(STEREO_MODES, paramDefault(Param.StereoMode)),
    width: paramDefault(Param.StereoWidth),
    polarityRight: false,
    crossfeed: false,
    bands: [],
    device: null,
    dim: false,
    normalise: false,
    matchEq: null,
  },
};

/**
 * The auditions that must never outlive a reload: a listener who forgot
 * they left the track dimmed, a band soloed, one channel or a device curve
 * on would hear a broken mix and not know why.
 */
export function withoutDangerousAuditions(settings: LabSettings): LabSettings {
  const { stereo, bands, device, dim } = DEFAULT_LAB.auditions;
  return {
    ...settings,
    auditions: { ...settings.auditions, stereo, bands, device, dim },
  };
}

export const clampSpeed = (speed: number) =>
  Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));

/** Source seconds heard per second of playback. */
export const playbackSpeed = (settings: LabSettings) =>
  settings.mode === "pitch" ? 1 : settings.speed;

/**
 * The rate an audio element plays at while the Lab is not live: tape-style
 * speed is the one change an element makes itself, so only linked mode
 * reaches it.
 */
export const elementRate = (settings: LabSettings) =>
  settings.mode === "linked" ? settings.speed : 1;

/** Whether time and pitch as set need the Lab, which alone can hold pitch. */
function timePitchNeedsLab({ mode, speed, pitch }: LabSettings): boolean {
  switch (mode) {
    case "linked":
      return false;
    case "speed":
      return speed !== 1;
    case "pitch":
      return pitch !== 0;
    case "independent":
      return speed !== 1 || pitch !== 0;
  }
}

/**
 * Whether any setting changes what is heard beyond what an audio element
 * can do itself: time and pitch the element cannot hold, a rack block
 * switched on, or an audition away from its default.
 */
export function settingsNeedLab(settings: LabSettings): boolean {
  const { rack, auditions } = settings;
  const defaults = DEFAULT_LAB.auditions;
  return (
    timePitchNeedsLab(settings) ||
    rack.eq.on ||
    rack.comp.on ||
    rack.reverb.on ||
    auditions.stereo !== defaults.stereo ||
    auditions.width !== defaults.width ||
    auditions.polarityRight !== defaults.polarityRight ||
    auditions.crossfeed !== defaults.crossfeed ||
    auditions.bands.length > 0 ||
    auditions.device !== defaults.device ||
    auditions.dim !== defaults.dim ||
    auditions.normalise !== defaults.normalise ||
    auditions.matchEq !== defaults.matchEq
  );
}

/**
 * The engagement rule: the Lab is wanted while pinned, while any setting
 * needs it, or while an A/B comparison runs, which plays both sources on it.
 */
export function labWanted({
  settings,
  pinned,
  comparing,
}: {
  settings: LabSettings;
  pinned: boolean;
  comparing: boolean;
}): boolean {
  return comparing || pinned || settingsNeedLab(settings);
}

export type ChainParams = {
  values: [ParamId, number][];
  bypass: [BlockId, boolean][];
};

/**
 * The chain parameters for `settings`, in parameter-id order (a reverb
 * preset sets its own pre-delay, so the pre-delay has to follow it).
 * `loudness` is what `normalise` reads.
 */
export function chainParams(
  settings: LabSettings,
  loudness: LabLoudness
): ChainParams {
  const { rack, auditions } = settings;
  const values: [ParamId, number][] = [
    [Param.TimeMode, TIME_MODES[settings.mode]],
    [Param.TimeSpeed, settings.speed],
    [Param.TimePitchSemitones, settings.pitch],
  ];
  for (const [band, param] of Object.entries(BANDS) as [BandKey, ParamId][]) {
    values.push([param, Number(auditions.bands.includes(band))]);
  }
  rack.eq.bands.slice(0, EQ_BANDS).forEach((band, i) => {
    const params = eqParams(i);
    values.push(
      [params.kind, FILTERS[band.kind]],
      [params.hz, band.hz],
      [params.gainDb, band.gainDb],
      [params.q, band.q]
    );
  });
  values.push(
    [Param.CompThresholdDb, rack.comp.thresholdDb],
    [Param.CompRatio, rack.comp.ratio],
    [Param.CompAttackMs, rack.comp.attackMs],
    [Param.CompReleaseMs, rack.comp.releaseMs],
    [Param.CompMakeupDb, rack.comp.makeupDb],
    [Param.ReverbPreset, PRESETS[rack.reverb.preset]],
    [Param.ReverbWet, rack.reverb.wet],
    [Param.ReverbPreDelayMs, rack.reverb.preDelayMs],
    [Param.StereoMode, STEREO_MODES[auditions.stereo]],
    [Param.StereoWidth, auditions.width],
    [Param.StereoInvertRight, Number(auditions.polarityRight)],
    [Param.Device, DEVICES[auditions.device ?? "phone"]],
    [Param.GainDim, Number(auditions.dim)],
    [Param.GainNormaliseDb, normaliseDb(auditions.normalise, loudness)]
  );
  for (const entry of values) entry[1] = withinDomain(entry[0], entry[1]);
  const bypass: [BlockId, boolean][] = [
    [Block.BandSolo, auditions.bands.length === 0],
    [Block.Eq, !rack.eq.on],
    [Block.Compressor, !rack.comp.on],
    [Block.Reverb, !rack.reverb.on],
    [Block.Crossfeed, !auditions.crossfeed],
    [Block.Device, auditions.device === null],
  ];
  return { values, bypass };
}

function normaliseDb(on: boolean, { lufs, targetLufs }: LabLoudness): number {
  if (!on || lufs === null || !Number.isFinite(lufs)) return 0;
  return targetLufs - lufs;
}

/**
 * A range parameter clamped into its domain (the chain refuses anything
 * outside it, NaN included, which reads as the default).
 */
function withinDomain(param: ParamId, value: number): number {
  const spec = PARAMS[param]!;
  if (spec.kind !== "range") return value;
  if (Number.isNaN(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

/**
 * A range parameter's bounds, straight off the generated table — so a
 * rack control's slider or numeric field always matches what the chain
 * actually accepts, rather than a hand-copied pair of numbers that a
 * changed Rust default would leave wrong with no error.
 */
export function paramRange(param: ParamId): { min: number; max: number } {
  const spec = PARAMS[param]!;
  if (spec.kind !== "range") {
    throw new Error(`${spec.name} is not a range parameter`);
  }
  return { min: spec.min, max: spec.max };
}

/**
 * The parameters and bypasses in `next` that differ from `previous`, so a
 * slider drag sends one value rather than the whole chain. A changed reverb
 * preset resends the pre-delay after it, since the preset resets it.
 */
export function changedParams(
  previous: ChainParams | null,
  next: ChainParams
): ChainParams {
  if (!previous) return next;
  const before = new Map(previous.values);
  const presetChanged =
    before.get(Param.ReverbPreset) !==
    next.values.find(([param]) => param === Param.ReverbPreset)?.[1];
  const beforeBypass = new Map(previous.bypass);
  return {
    values: next.values.filter(
      ([param, value]) =>
        before.get(param) !== value ||
        (presetChanged && param === Param.ReverbPreDelayMs)
    ),
    bypass: next.bypass.filter(
      ([block, bypassed]) => beforeBypass.get(block) !== bypassed
    ),
  };
}
