import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

export const group = defineGroup({
  id: "lab",
  section: "personal",
  label: "Lab",
  description:
    "What the Lab starts with and how far it goes. Changes made in the Lab stay in this browser.",
  order: 40,
});

/**
 * "The rack's own default" (the Lab's whole range, its own compressor, reverb
 * or EQ) as a stored value. It cannot be `null`: `null` in a settings patch
 * clears the row, which hands the choice back to an instance default. A
 * member who picks the rack default holds this literal instead.
 */
const rackDefault = z.strictObject({ rack: z.literal(true) });

export type RackDefault = z.infer<typeof rackDefault>;

export const RACK_DEFAULT: RackDefault = { rack: true };

/** Whether a Lab setting's value is the rack default rather than a value of its own. */
export const isRackDefault = (value: unknown): value is RackDefault =>
  rackDefault.safeParse(value).success;

/**
 * A range inside the Lab's own bounds. The Lab clamps it to them, so the
 * schema holds only its shape; the rack default is the Lab's whole range.
 */
const range = z.union([
  rackDefault,
  z
    .object({ min: z.number(), max: z.number() })
    .refine(({ min, max }) => min <= max, "The low end is above the high end."),
]);

/**
 * The rack parts a fresh browser's Lab starts with. The Lab owns their
 * parameters and bounds, so these hold their shape alone, and the rack
 * default is the rack's own.
 */
const compressor = z.union([
  rackDefault,
  z.object({
    on: z.boolean(),
    thresholdDb: z.number(),
    ratio: z.number(),
    attackMs: z.number(),
    releaseMs: z.number(),
    makeupDb: z.number(),
  }),
]);

const reverb = z.union([
  rackDefault,
  z.object({
    on: z.boolean(),
    preset: z.string().min(1),
    wet: z.number(),
    preDelayMs: z.number(),
  }),
]);

const eq = z.union([
  rackDefault,
  z.object({
    on: z.boolean(),
    bands: z.array(
      z.object({
        kind: z.string().min(1),
        hz: z.number(),
        gainDb: z.number(),
        q: z.number(),
      })
    ),
  }),
]);

export const settings = [
  defineSetting({
    key: "lab.timePitchMode",
    group: "lab",
    label: "Speed and pitch",
    description: "How the Lab's speed and pitch controls move together.",
    keywords: ["tempo", "pitch", "time stretch", "varispeed"],
    scopes: ["user", "instance"],
    schema: z.enum(["speed", "pitch", "linked", "independent"]),
    default: "speed",
    control: {
      kind: "select",
      options: optionsOf({
        speed: "Speed only",
        pitch: "Pitch only",
        linked: "Linked, like tape",
        independent: "Independent",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "lab.speedRange",
    group: "lab",
    label: "Speed range",
    description: "Where the speed control stops either way.",
    keywords: ["tempo", "slow", "fast"],
    scopes: ["user", "instance"],
    schema: range,
    default: RACK_DEFAULT,
    control: { kind: "custom", component: "lab-speed-range" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.pitchRange",
    group: "lab",
    label: "Pitch range",
    description: "Where the pitch control stops either way, in semitones.",
    keywords: ["semitones", "transpose"],
    scopes: ["user", "instance"],
    schema: range,
    default: RACK_DEFAULT,
    control: { kind: "custom", component: "lab-pitch-range" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.rememberAuditions",
    group: "lab",
    label: "Remember auditions",
    description:
      "Width, crossfeed, polarity, normalise and match EQ survive a reload. Solos, dim and device curves never do.",
    keywords: ["reload", "auditions", "remember"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.keepEngaged",
    group: "lab",
    label: "Stay engaged",
    description:
      "Once the Lab is engaged it stays engaged until the page closes.",
    keywords: ["engage", "release", "bypass"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.releaseDelay",
    group: "lab",
    label: "Release after",
    description:
      "How long the Lab stays engaged after its last change goes back to neutral.",
    keywords: ["release", "bypass", "delay"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(0).max(60),
    default: 2,
    control: { kind: "duration", unit: "s", min: 0, max: 60 },
    audience: "all",
  }),
  defineSetting({
    key: "lab.normaliseTarget",
    group: "lab",
    label: "Normalise to",
    description: "The loudness Normalise brings a version to.",
    keywords: ["lufs", "loudness", "normalise", "level"],
    scopes: ["user", "project", "instance"],
    schema: z.number().min(-30).max(0),
    default: -14,
    control: { kind: "slider", min: -24, max: -6, step: 1, unit: "LUFS" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.compressor",
    group: "lab",
    label: "Compressor",
    description: "The compressor a fresh browser's rack starts with.",
    keywords: ["comp", "dynamics", "rack"],
    scopes: ["user", "instance"],
    schema: compressor,
    default: RACK_DEFAULT,
    control: { kind: "custom", component: "lab-compressor" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.reverb",
    group: "lab",
    label: "Reverb",
    description: "The reverb a fresh browser's rack starts with.",
    keywords: ["verb", "room", "space", "rack"],
    scopes: ["user", "instance"],
    schema: reverb,
    default: RACK_DEFAULT,
    control: { kind: "custom", component: "lab-reverb" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.eqPreset",
    group: "lab",
    label: "EQ",
    description: "The EQ a fresh browser's rack starts with.",
    keywords: ["equaliser", "bands", "filter", "rack"],
    scopes: ["user", "instance"],
    schema: eq,
    default: RACK_DEFAULT,
    control: { kind: "custom", component: "lab-eq" },
    audience: "all",
  }),
  defineSetting({
    key: "lab.bounceFormat",
    group: "lab",
    label: "Bounce format",
    description: "What a bounce is written as.",
    keywords: ["export", "flac", "render", "file"],
    scopes: ["user", "instance"],
    schema: z.enum(["flac-24"]),
    default: "flac-24",
    control: {
      kind: "select",
      options: optionsOf({ "flac-24": "FLAC, 24-bit" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "lab.bounceNameTemplate",
    group: "lab",
    label: "Bounce file name",
    description:
      "{title} is the track's, {version} the version, {settings} what the Lab changed, and {details} the last two in brackets.",
    keywords: ["file name", "export", "template"],
    scopes: ["user", "instance"],
    schema: z.string().trim().min(1).max(200),
    default: "{title} — Lab bounce{details}",
    control: { kind: "text" },
    audience: "all",
  }),
];
