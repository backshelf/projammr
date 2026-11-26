import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

const LANDING_VALUES = [
  "last-project",
  "project",
  "projects",
  "notebook",
] as const;

/** A project of the caller's own; `null` is "none chosen". */
const chosenProject = z.number().int().positive().nullable();

export const group = defineGroup({
  id: "navigation",
  section: "personal",
  label: "Navigation",
  description: "What “/” opens to when you sign in.",
  order: 75,
});

export const settings = [
  defineSetting({
    key: "navigation.landing",
    group: "navigation",
    label: "Landing page",
    description:
      "What “/” opens: your last project, a project you choose, the projects list, or your notebook.",
    keywords: ["home", "start", "default page", "open"],
    scopes: ["user", "instance"],
    schema: z.enum(LANDING_VALUES),
    default: "last-project",
    control: {
      kind: "select",
      options: optionsOf({
        "last-project": "Last project",
        project: "A chosen project",
        projects: "The projects list",
        notebook: "Notebook",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "navigation.defaultProject",
    group: "navigation",
    label: "Default project",
    description:
      "The project “Landing page” opens to when it is set to a chosen project.",
    keywords: ["home", "start", "default project"],
    scopes: ["user", "instance"],
    schema: chosenProject,
    default: null,
    control: { kind: "custom", component: "project-picker" },
    audience: "all",
  }),
];
