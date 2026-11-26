/**
 * The one place the settings' names meet the policies': each policy, and the
 * format preferences, built from a set of effective settings. The server
 * builds them from its read (`cachedPolicies()`, `viewerFormat()`) and the
 * client from the settings store as it changes, so both run through here.
 *
 * Settings hold what a person chooses in the units they choose it in; a
 * policy holds what the code reads. The mappings convert seconds to
 * milliseconds, turn a week-start name into a day number, reduce an arranged
 * list to the ids it shows, and fill the gaps a setting leaves open with the
 * Lab's own defaults and bounds.
 */

import {
  DEFAULT_LAB,
  EQ_BANDS,
  isEqFilter,
  isReverbPreset,
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
  type LabSettings,
  type ReverbSettings,
} from "@/lib/dsp/lab-settings";
import {
  clampToRange,
  type LabPolicy,
  type LabRange,
} from "@/lib/policies/lab";
import type { PlaybackPolicy } from "@/lib/policies/playback";
import type { Policies } from "@/lib/policies/policies";
import {
  DELETE_KINDS,
  shownSections,
  type DeleteKind,
  type FeedbackPolicy,
  type ShellPolicy,
} from "@/lib/policies/shell";
import type { VisualsPolicy } from "@/lib/policies/visuals";
import { knownStrips } from "@/components/track-audio/strip-legend";
import { SETTINGS, type SettingsValues } from "@workspace/settings";
import { completeArrangedList } from "@workspace/settings/options";
import type { WeekStart } from "@workspace/settings/groups/formats";
import { isRackDefault } from "@workspace/settings/groups/lab";
import type { FormatPrefs } from "@workspace/ui/lib/formatters";

/** A duration a setting holds in seconds, as the milliseconds a policy reads. */
export const secondsToMs = (seconds: number) => seconds * 1000;

const playbackFrom = (values: SettingsValues): PlaybackPolicy => ({
  defaultVolume: values["playback.defaultVolume"],
  startMuted: values["playback.startMuted"],
  repeat: values["playback.repeat"],
  shuffle: values["playback.shuffle"],
  persistQueue: values["playback.persistQueue"],
  seekSmallSeconds: values["playback.seekSmall"],
  seekLargeSeconds: values["playback.seekLarge"],
  previousRestartsAfterSeconds: values["playback.previousRestartsAfter"],
  queueEnd: values["playback.queueEnd"],
  queueingStarts: values["playback.queueingStarts"],
  rowPlayContext: values["playback.rowPlayContext"],
  versionToPlay: values["playback.versionToPlay"],
  noAudioFallback: values["playback.noAudioFallback"],
  analysisOnTouch: values["playback.analysisOnTouch"],
  crossfadeSeconds: values["playback.crossfade"],
});

/**
 * A Lab range as a setting holds it, inside the Lab's own `bounds`: the rack
 * default is the whole of them, and either end past them stops at them.
 */
function labRange(
  range: SettingsValues["lab.speedRange"],
  bounds: LabRange
): LabRange {
  if (isRackDefault(range)) return bounds;
  return {
    min: clampToRange(range.min, bounds),
    max: clampToRange(range.max, bounds),
  };
}

/** A stored compressor, or the rack's own when the setting holds the rack default. */
function labCompressor(
  compressor: SettingsValues["lab.compressor"]
): LabSettings["rack"]["comp"] {
  return isRackDefault(compressor) ? DEFAULT_LAB.rack.comp : compressor;
}

/** A stored reverb, or the rack's own when the setting holds the rack default or it names a preset the chain does not know. */
function labReverb(
  reverb: SettingsValues["lab.reverb"]
): LabSettings["rack"]["reverb"] {
  if (isRackDefault(reverb) || !isReverbPreset(reverb.preset)) {
    return DEFAULT_LAB.rack.reverb;
  }
  return { ...reverb, preset: reverb.preset } satisfies ReverbSettings;
}

/**
 * A stored EQ, or the rack's own when the setting holds the rack default, or
 * when it is not one band per chain band, each of a filter the chain knows.
 */
function labEq(eq: SettingsValues["lab.eqPreset"]): LabSettings["rack"]["eq"] {
  if (isRackDefault(eq) || eq.bands.length !== EQ_BANDS) {
    return DEFAULT_LAB.rack.eq;
  }
  const bands: LabSettings["rack"]["eq"]["bands"] = [];
  for (const band of eq.bands) {
    if (!isEqFilter(band.kind)) return DEFAULT_LAB.rack.eq;
    bands.push({ ...band, kind: band.kind });
  }
  return { on: eq.on, bands };
}

export const labFrom = (values: SettingsValues): LabPolicy => ({
  timePitchMode: values["lab.timePitchMode"],
  speedRange: labRange(values["lab.speedRange"], {
    min: SPEED_MIN,
    max: SPEED_MAX,
  }),
  pitchRange: labRange(values["lab.pitchRange"], {
    min: PITCH_MIN,
    max: PITCH_MAX,
  }),
  rememberAuditions: values["lab.rememberAuditions"],
  keepEngaged: values["lab.keepEngaged"],
  releaseDelayMs: secondsToMs(values["lab.releaseDelay"]),
  normaliseTargetLufs: values["lab.normaliseTarget"],
  compressor: labCompressor(values["lab.compressor"]),
  reverb: labReverb(values["lab.reverb"]),
  eqPreset: labEq(values["lab.eqPreset"]),
  bounceFormat: values["lab.bounceFormat"],
  bounceNameTemplate: values["lab.bounceNameTemplate"],
});

export const visualsFrom = (values: SettingsValues): VisualsPolicy => ({
  loudnessReferenceLufs: values["visuals.loudnessReference"],
  meterBallistics: values["visuals.meterBallistics"],
  waveformDetail: values["visuals.waveformDetail"],
  waveformHeight: values["visuals.waveformHeight"],
  strips: knownStrips(values["visuals.strips"]),
  lavaField: values["visuals.lavaField"],
  artBreathes: values["visuals.artBreathes"],
});

/** The ids an arranged list shows, in its order. */
const shownIds = <Id extends string>(
  list: readonly { id: Id; shown: boolean }[]
): Id[] => shownSections(list).map(({ id }) => id);

type ArrangedKey =
  | "layout.sidebarSections"
  | "layout.dockTabs"
  | "palette.emptyGroups"
  | "pages.projectHomeSections"
  | "pages.collectionSections"
  | "pages.trackSections"
  | "pages.sessionSections";

/** An arranged list made whole against its setting's default: an id the stored list leaves out is shown. */
const completed = <K extends ArrangedKey>(
  values: SettingsValues,
  key: K
): SettingsValues[K] =>
  completeArrangedList(
    values[key] as readonly { id: string }[],
    SETTINGS[key].default as readonly { id: string }[]
  ) as SettingsValues[K];

export const shellFrom = (values: SettingsValues): ShellPolicy => ({
  sidebarWidthRem: values["layout.sidebarWidth"],
  recentItems: values["layout.recentItems"],
  recentsSkipArchived: values["layout.recentsSkipArchived"],
  sidebarSections: completed(values, "layout.sidebarSections"),
  sidebarCollectionOrder: values["layout.sidebarCollectionOrder"],
  dockTabs: shownIds(completed(values, "layout.dockTabs")),
  paletteResultCap: values["palette.resultCap"],
  paletteAliases: values["palette.aliases"],
  paletteEmptyGroups: shownIds(completed(values, "palette.emptyGroups")),
  projectHomeSections: completed(values, "pages.projectHomeSections"),
  entityPageSections: {
    collection: completed(values, "pages.collectionSections"),
    track: completed(values, "pages.trackSections"),
    session: completed(values, "pages.sessionSections"),
  },
  inventoryDefaults: {
    plugins: {
      origin: values["pages.pluginsOrigin"],
      stock: values["pages.pluginsStock"],
    },
    samples: {
      show: values["pages.samplesShow"],
      library: values["pages.samplesLibrary"],
      stock: values["pages.samplesStock"],
    },
  },
  afterCreate: values["pages.afterCreate"],
  audioCommentPinned: values["pages.audioCommentPinned"],
  commandBar: {
    enabled: values["commands.barEnabled"],
    position: values["commands.barPosition"],
    mode: values["commands.barMode"],
  },
});

export const feedbackFrom = (values: SettingsValues): FeedbackPolicy => {
  const confirms = values["feedback.confirmDeletes"];
  return {
    haptics: values["feedback.haptics"],
    toastDurationMs: secondsToMs(values["feedback.toastDuration"]),
    toastPosition: values["feedback.toastPosition"],
    // A kind the setting leaves out asks, as every delete always has.
    confirmDeletes: Object.fromEntries(
      DELETE_KINDS.map((kind) => [kind, confirms[kind] ?? true])
    ) as Record<DeleteKind, boolean>,
    undoWindowMs: secondsToMs(values["feedback.undoWindow"]),
  };
};

/** The day each week start names, as the formatters count days. */
const WEEK_START_DAYS: Record<WeekStart, FormatPrefs["weekStart"]> = {
  sunday: 0,
  monday: 1,
  saturday: 6,
};

export const formatPrefsFrom = (values: SettingsValues): FormatPrefs => ({
  locale: values["formats.locale"],
  clock: values["formats.clock"],
  relativeWording: values["formats.relativeWording"],
  weekStart: WEEK_START_DAYS[values["formats.weekStart"]],
  timeZone: values["formats.timeZone"],
  tempo: {
    rounding: values["formats.tempoRounding"],
    suffix: values["formats.tempoSuffix"],
  },
  keyNotation: values["formats.keyNotation"],
  playerTime: values["formats.playerTime"],
});

/** Every policy the signed-in shell hands down. */
export const policiesFrom = (values: SettingsValues): Policies => ({
  playback: playbackFrom(values),
  lab: labFrom(values),
  visuals: visualsFrom(values),
  shell: shellFrom(values),
  feedback: feedbackFrom(values),
});
