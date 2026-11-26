import { defineGroup, defineSetting, wholeNumber } from "../define.js";

export const group = defineGroup({
  id: "project-conventions",
  section: "project",
  label: "Conventions",
  description:
    "The windows a project's home reads: when a track counts as quiet, and how far back a render or a save still counts as new.",
  order: 90,
});

export const settings = [
  defineSetting({
    key: "project-conventions.quietAfterDays",
    group: "project-conventions",
    label: "Quiet after",
    description:
      "Days untouched before a track counts as quiet on the project's home. Zero counts nothing quiet.",
    keywords: ["quiet", "stale", "inactive", "home"],
    scopes: ["project", "instance"],
    schema: wholeNumber(0, 3650),
    default: 30,
    control: { kind: "duration", unit: "d", min: 0, max: 3650 },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-conventions.todayNewHours",
    group: "project-conventions",
    label: "New since",
    description:
      "Hours back a render or a save still counts as new on the project's home.",
    keywords: ["new", "recent", "home", "window"],
    scopes: ["project", "instance"],
    schema: wholeNumber(1, 168),
    default: 24,
    control: { kind: "duration", unit: "h", min: 1, max: 168 },
    minRole: "admin",
    audience: "all",
  }),
];
