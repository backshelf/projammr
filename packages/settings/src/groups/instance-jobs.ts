import {
  defineGroup,
  defineSetting,
  INSTANCE_ONLY,
  wholeNumber,
} from "../define.js";

export const group = defineGroup({
  id: "instance-jobs",
  section: "instance",
  label: "Background work",
  description:
    "How much analysis the server runs at once, and how long it keeps a record of what was done.",
  order: 40,
});

export const settings = [
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-jobs.analysisWorkers",
    group: "instance-jobs",
    label: "Jobs at once",
    description:
      "How many background jobs run together. Each analysis runs ffmpeg, so more finish sooner but load the server harder. MEDIA_CONCURRENCY gives it until it is set here.",
    keywords: ["concurrency", "workers", "analysis", "ffmpeg", "jobs"],
    schema: wholeNumber(1, 64),
    default: 1,
    control: { kind: "number", min: 1, max: 64, step: 1, unit: "jobs" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-jobs.jobRetentionDays",
    group: "instance-jobs",
    label: "Keep finished jobs for",
    description: "How long the record of a finished job is kept.",
    keywords: ["jobs", "history", "cleanup", "retention"],
    schema: wholeNumber(1, 3650),
    default: 7,
    control: { kind: "duration", unit: "d", min: 1, max: 3650 },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-jobs.activityRetentionDays",
    group: "instance-jobs",
    label: "Keep activity for",
    description: "How long activity is kept. Empty keeps it forever.",
    keywords: ["activity", "history", "cleanup", "retention"],
    schema: wholeNumber(1, 36500).nullable(),
    default: null,
    control: {
      kind: "duration",
      unit: "d",
      min: 1,
      max: 36500,
      placeholder: "Forever",
    },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-jobs.saveContentRetentionDays",
    group: "instance-jobs",
    label: "Keep the content of uncommitted saves for",
    description:
      "How long the content of a save that was never committed is kept. After this the save stays in the history but its content is removed.",
    keywords: ["saves", "uncommitted", "content", "cleanup", "retention"],
    schema: wholeNumber(1, 36500),
    default: 90,
    control: { kind: "duration", unit: "d", min: 1, max: 36500 },
    audience: "admin",
  }),
];
