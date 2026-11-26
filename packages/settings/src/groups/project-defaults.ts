import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";

export const group = defineGroup({
  id: "project-defaults",
  section: "project",
  label: "Defaults",
  description:
    "What a new track, collection or session in this project starts with, for whatever its creation leaves out.",
  order: 70,
});

export const settings = [
  defineSetting({
    key: "project-defaults.trackStatusId",
    group: "project-defaults",
    label: "New track status",
    description:
      "The status a new track gets when its creation names none. A status this project no longer has is skipped, and the track falls to the column default.",
    keywords: ["track", "status", "default", "new"],
    scopes: ["project", "instance"],
    schema: z.number().int().positive(),
    default: 1,
    control: { kind: "custom", component: "project-status" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-defaults.collectionStatusId",
    group: "project-defaults",
    label: "New collection status",
    description:
      "The status a new collection gets when its creation names none, skipped the same way as a track's.",
    keywords: ["collection", "status", "default", "new"],
    scopes: ["project", "instance"],
    schema: z.number().int().positive(),
    default: 1,
    control: { kind: "custom", component: "project-status" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-defaults.labelIds",
    group: "project-defaults",
    label: "New track and collection labels",
    description:
      "The labels a new track or collection carries when its creation names none. A label this project no longer has is skipped.",
    keywords: ["labels", "default", "new", "track", "collection"],
    scopes: ["project", "instance"],
    schema: z.array(z.number().int().positive()),
    default: [],
    control: { kind: "custom", component: "project-labels" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-defaults.artists",
    group: "project-defaults",
    label: "New track artists",
    description:
      "The artists a new track carries when its creation leaves the field blank.",
    keywords: ["artists", "default", "new", "track"],
    scopes: ["project", "instance"],
    schema: z.array(z.string()),
    default: [],
    control: { kind: "list", item: "text" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-defaults.explicit",
    group: "project-defaults",
    label: "New tracks explicit",
    description: "Whether a new track is marked explicit by default.",
    keywords: ["explicit", "default", "new", "track"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-defaults.newSessionMain",
    group: "project-defaults",
    label: "New session becomes main",
    description:
      "Whether a new session linked to a track becomes that track's main session, taking over from the one before.",
    keywords: ["session", "main", "default", "new"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
];
