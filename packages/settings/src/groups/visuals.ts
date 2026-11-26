import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

/** The strips that can show under a track page's waveform, top to bottom. */
export const STRIP_IDS = ["loudness", "spectrogram", "change"] as const;

export type StripId = (typeof STRIP_IDS)[number];

export const STRIP_LABELS: Readonly<Record<StripId, string>> = {
  loudness: "Loudness",
  spectrogram: "Spectrogram",
  change: "Change",
};

export const group = defineGroup({
  id: "visuals",
  section: "personal",
  label: "Visuals",
  description: "How audio is drawn: meters, waveforms and the moving field.",
  order: 35,
});

export const settings = [
  defineSetting({
    key: "visuals.loudnessReference",
    group: "visuals",
    label: "Loudness reference",
    description:
      "The level the loudness scales and strip mark with a dotted line.",
    keywords: ["lufs", "loudness", "meter", "target", "streaming"],
    scopes: ["user", "project", "instance"],
    schema: z.number().min(-30).max(0),
    default: -14,
    control: { kind: "slider", min: -24, max: -6, step: 1, unit: "LUFS" },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.meterBallistics",
    group: "visuals",
    label: "Meter speed",
    description:
      "How quickly live meters follow the audio: below 1 faster, above it slower.",
    keywords: ["meter", "ballistics", "rise", "fall", "decay"],
    scopes: ["user", "instance"],
    schema: z.number().min(0.25).max(4),
    default: 1,
    control: { kind: "slider", min: 0.25, max: 4, step: 0.25, unit: "×" },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.waveformDetail",
    group: "visuals",
    label: "Waveform detail",
    description:
      "How wide one bar of a track's waveform is; narrower bars draw finer detail.",
    keywords: ["waveform", "bars", "resolution"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(2).max(12),
    default: 4,
    control: { kind: "slider", min: 2, max: 12, step: 1, unit: "px" },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.waveformHeight",
    group: "visuals",
    label: "Waveform height",
    description: "The height of the waveform that leads a track page.",
    keywords: ["waveform", "size", "tall"],
    scopes: ["user", "instance"],
    schema: z.enum(["lg", "md"]),
    default: "lg",
    control: {
      kind: "select",
      options: optionsOf({ lg: "Tall", md: "Short" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.strips",
    group: "visuals",
    label: "Strips",
    description: "The analysis strips shown under a track's waveform.",
    keywords: ["loudness", "spectrogram", "change", "analysis"],
    scopes: ["user", "instance"],
    // Any id, so a strip a later build retires drops out where the list is
    // read rather than throwing the viewer's whole choice away.
    schema: z.array(z.string().min(1)),
    default: [...STRIP_IDS],
    control: { kind: "multiselect", options: optionsOf(STRIP_LABELS) },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.lavaField",
    group: "visuals",
    label: "Moving field",
    description: "The now-playing view's background moves with the audio.",
    keywords: ["lava", "background", "now playing", "animation"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "visuals.artBreathes",
    group: "visuals",
    label: "Artwork breathes",
    description: "The artwork around a playing record swells with its level.",
    keywords: ["artwork", "pulse", "level", "animation"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
];
