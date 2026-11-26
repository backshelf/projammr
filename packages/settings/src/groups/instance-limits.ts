import { z } from "zod";
import { MAX_UPLOAD_CEILING_MB } from "../bounds.js";
import {
  defineGroup,
  defineSetting,
  INSTANCE_ONLY,
  wholeNumber,
} from "../define.js";
import { listed } from "../options.js";

/**
 * The audio formats the server can read at all, by extension: what ffmpeg
 * decodes for analysis and conversion. An instance can narrow the uploads it
 * takes to a subset (`instance-limits.audioTypes`), never widen them.
 */
export const AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".aiff",
  ".aif",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

/** The image types the server can resize, by MIME type; `instance-limits.imageTypes` narrows them. */
export const IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/gif",
] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

/** What the storage audit does with a file no row names: remove it, or only count it. */
export const ORPHAN_MODES = ["delete", "report"] as const;

const ORPHAN_LABELS: Record<(typeof ORPHAN_MODES)[number], string> = {
  delete: "Delete it",
  report: "Only report it",
};

/**
 * A storage cap in GiB, or none. None is the absence of a row (and of the
 * variable that seeds it); zero is a cap that takes nothing more.
 */
const cap = z.number().nonnegative().nullable();

const capDescription = (whose: string, variable: string) =>
  `The most ${whose} may store, in GB. Empty sets no cap. When ${variable} is set, it gives the cap: you can change it here, but only unsetting the variable removes it.`;

export const group = defineGroup({
  id: "instance-limits",
  section: "instance",
  label: "Limits",
  description:
    "What an upload may be, how much each project and account may store, and how storage is kept tidy.",
  order: 30,
});

export const settings = [
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.maxUploadMb",
    group: "instance-limits",
    label: "Largest upload",
    description: `The largest file one upload can carry, at most ${MAX_UPLOAD_CEILING_MB} MB. MAX_UPLOAD_MB gives it until it is set here.`,
    keywords: ["upload", "file size", "limit", "megabytes"],
    schema: z.number().positive().max(MAX_UPLOAD_CEILING_MB),
    default: 128,
    control: { kind: "number", min: 1, max: MAX_UPLOAD_CEILING_MB, unit: "MB" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.projectCapGb",
    group: "instance-limits",
    label: "Storage per project",
    description: capDescription("one project", "MAX_PROJECT_GB"),
    keywords: ["storage", "quota", "cap", "disk", "gigabytes"],
    schema: cap,
    default: null,
    control: { kind: "number", min: 0, unit: "GB", placeholder: "No cap" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.userCapGb",
    group: "instance-limits",
    label: "Storage per account",
    description: capDescription(
      "one account, across every project,",
      "MAX_USER_GB"
    ),
    keywords: ["storage", "quota", "cap", "disk", "gigabytes"],
    schema: cap,
    default: null,
    control: { kind: "number", min: 0, unit: "GB", placeholder: "No cap" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.audioTypes",
    group: "instance-limits",
    label: "Audio formats",
    description: `The audio formats an upload may be, by extension. The server can read ${AUDIO_EXTENSIONS.join(", ")}.`,
    keywords: ["audio", "formats", "extensions", "wav", "mp3", "upload"],
    schema: z.array(z.enum(AUDIO_EXTENSIONS)),
    default: [...AUDIO_EXTENSIONS],
    control: { kind: "multiselect", options: listed(AUDIO_EXTENSIONS) },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.imageTypes",
    group: "instance-limits",
    label: "Image formats",
    description: `The image formats an upload may be, by type. The server can read ${IMAGE_TYPES.join(", ")}.`,
    keywords: ["image", "formats", "cover", "jpeg", "png", "upload"],
    schema: z.array(z.enum(IMAGE_TYPES)),
    default: [...IMAGE_TYPES],
    control: { kind: "multiselect", options: listed(IMAGE_TYPES) },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.auditIntervalHours",
    group: "instance-limits",
    label: "Storage audit every",
    description:
      "How often the server recounts what each project and account stores, and looks for files no record names.",
    keywords: ["audit", "storage", "orphans", "recount"],
    schema: wholeNumber(1, 30 * 24),
    default: 24,
    control: { kind: "duration", unit: "h", min: 1, max: 30 * 24 },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.orphanMode",
    group: "instance-limits",
    label: "A file no record names",
    description:
      "What the storage audit does with a stored file nothing points at any more.",
    keywords: ["audit", "orphans", "cleanup", "storage"],
    schema: z.enum(ORPHAN_MODES),
    default: "delete",
    control: {
      kind: "select",
      options: ORPHAN_MODES.map((value) => ({
        value,
        label: ORPHAN_LABELS[value],
      })),
    },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.pushSamplesEverywhere",
    group: "instance-limits",
    label: "Push samples from every repository",
    description:
      "Every dit repository on this instance pushes its sample files with each commit, whatever its own switch says, and the switch is locked on. Samples are stored once however many repositories use them.",
    keywords: ["dit", "samples", "repository", "push", "storage"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.guestRetentionDays",
    group: "instance-limits",
    label: "Keep idle guests for",
    description:
      "How long a share-page guest who never commented is kept after their last visit.",
    keywords: ["guest", "share", "cleanup", "retention"],
    schema: wholeNumber(1, 3650),
    default: 30,
    control: { kind: "duration", unit: "d", min: 1, max: 3650 },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-limits.longestAudioHours",
    group: "instance-limits",
    label: "Longest audio",
    description:
      "The most audio an analysis or a conversion reads from one file, whatever length the file declares.",
    keywords: ["audio", "duration", "analysis", "conversion"],
    schema: z.number().positive().max(24),
    default: 6,
    control: { kind: "duration", unit: "h", max: 24 },
    audience: "admin",
  }),
];
