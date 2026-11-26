import { z } from "zod";
import { defineGroup, defineSetting, wholeNumber } from "../define.js";
import { optionsOf } from "../options.js";

/**
 * Which file of a duplicate bounce the duplicate audit keeps: the largest, a
 * tie going to a lossless format, or a lossless one, a tie going to the
 * larger. A tie on both goes to the file whose path sorts first.
 */
export const DUPLICATE_KEEPS = ["largest", "lossless"] as const;

export type DuplicateKeep = (typeof DUPLICATE_KEEPS)[number];

/** The bitrates an MP3 conversion may use, as the strings a select control edits. */
export const MP3_KBPS_OPTIONS = [
  "320",
  "256",
  "192",
  "128",
  "96",
  "64",
  "32",
  "16",
] as const;

export const group = defineGroup({
  id: "project-audio",
  section: "project",
  label: "Audio",
  description:
    "The audit thresholds, the duplicate and tempo/key rules, the MP3 bitrate, and the project's own storage cap.",
  order: 100,
});

export const settings = [
  defineSetting({
    key: "project-audio.auditTooShortSeconds",
    group: "project-audio",
    label: "Too short below",
    description: "A version shorter than this is flagged too short.",
    keywords: ["audit", "short", "duration"],
    scopes: ["project", "instance"],
    schema: z.number().positive(),
    default: 15,
    control: { kind: "number", min: 0, unit: "s" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.auditNearSilentLufs",
    group: "project-audio",
    label: "Near-silent below",
    description:
      "A version quieter than this integrated loudness is flagged near-silent.",
    keywords: ["audit", "silent", "loudness", "lufs"],
    scopes: ["project", "instance"],
    schema: z.number().max(0),
    default: -40,
    control: { kind: "number", max: 0, unit: "LUFS" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.auditHotPeakDbtp",
    group: "project-audio",
    label: "Hot peak above",
    description: "A version whose true peak passes this is flagged hot.",
    keywords: ["audit", "hot", "peak", "clipping"],
    scopes: ["project", "instance"],
    schema: z.number(),
    default: -1,
    control: { kind: "number", unit: "dBTP" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.auditLeadSilenceSeconds",
    group: "project-audio",
    label: "Lead silence above",
    description: "Leading silence longer than this is flagged.",
    keywords: ["audit", "silence", "lead", "intro"],
    scopes: ["project", "instance"],
    schema: z.number().nonnegative(),
    default: 2,
    control: { kind: "number", min: 0, unit: "s" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.auditTailSilenceSeconds",
    group: "project-audio",
    label: "Tail silence above",
    description: "Trailing silence longer than this is flagged.",
    keywords: ["audit", "silence", "tail", "outro"],
    scopes: ["project", "instance"],
    schema: z.number().nonnegative(),
    default: 3,
    control: { kind: "number", min: 0, unit: "s" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.auditNameMismatch",
    group: "project-audio",
    label: "Name mismatch below",
    description:
      "The file-name-to-title similarity below which a version's name can read as another track's.",
    keywords: ["audit", "name", "title", "mismatch"],
    scopes: ["project", "instance"],
    schema: z.number().min(0).max(1),
    default: 0.3,
    control: { kind: "number", min: 0, max: 1, step: 0.05 },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.tempoKeyCorrection",
    group: "project-audio",
    label: "Tempo/key correction",
    description:
      "Whether analysis settles a detected tempo octave and key mode against the track's main session.",
    keywords: ["tempo", "key", "correction", "analysis"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.tempoKeyCorrectionPercent",
    group: "project-audio",
    label: "Tempo correction margin",
    description:
      "How close, in percent of the session tempo, a doubled or halved tempo must land to be taken.",
    keywords: ["tempo", "correction", "percent", "margin"],
    scopes: ["project", "instance"],
    schema: z.number().min(0).max(100),
    default: 4,
    control: { kind: "number", min: 0, max: 100, unit: "%" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.sameBounceWindowMinutes",
    group: "project-audio",
    label: "Same-bounce window",
    description:
      "How far apart two formats of one bounce can have been written.",
    keywords: ["duplicate", "bounce", "window"],
    scopes: ["project", "instance"],
    schema: wholeNumber(0, 1440),
    default: 2,
    control: { kind: "duration", unit: "min", min: 0, max: 1440 },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.duplicateKeep",
    group: "project-audio",
    label: "Duplicate keeps",
    description:
      "Which file of a duplicate bounce the duplicate audit keeps: the largest, a tie going to a lossless format, or a lossless one, a tie going to the larger. A tie on both goes to the file whose path sorts first.",
    keywords: ["duplicate", "keep", "largest", "lossless"],
    scopes: ["project", "instance"],
    schema: z.enum(DUPLICATE_KEEPS),
    default: "largest",
    control: {
      kind: "select",
      options: optionsOf({ largest: "Largest", lossless: "Lossless" }),
    },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.mp3Kbps",
    group: "project-audio",
    label: "MP3 bitrate",
    description:
      "The bitrate an MP3 conversion uses when its request names none.",
    keywords: ["mp3", "bitrate", "kbps", "convert"],
    scopes: ["project", "instance"],
    schema: z.enum(MP3_KBPS_OPTIONS),
    default: "320",
    control: {
      kind: "select",
      options: MP3_KBPS_OPTIONS.map((value) => ({
        value,
        label: `${value} kbps`,
      })),
    },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.autoAnalyse",
    group: "project-audio",
    label: "Auto-analyse",
    description:
      "Whether linking a version queues its analysis, and whether a boot fills in what is outstanding.",
    keywords: ["analyse", "auto", "boot", "queue"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-audio.storageCapGb",
    group: "project-audio",
    label: "Storage cap",
    description:
      "The project's own storage cap, in GB. Empty sets none; the instance's cap still applies above it.",
    keywords: ["storage", "quota", "cap", "gigabytes"],
    scopes: ["project", "instance"],
    schema: z.number().nonnegative().nullable(),
    default: null,
    control: { kind: "number", min: 0, unit: "GB", placeholder: "No cap" },
    minRole: "owner",
    audience: "all",
  }),
];
