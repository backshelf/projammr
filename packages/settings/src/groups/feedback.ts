import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

/**
 * Every kind of delete that can ask before it runs, named by what goes and
 * where from: `file` is a row of the project's Files table, `attachment` a
 * file deleted from the list on an entity's page, `audioVersion` a file
 * deleted from a track's audio versions.
 */
export const DELETE_KINDS = [
  "project",
  "collection",
  "track",
  "session",
  "note",
  "status",
  "label",
  "file",
  "attachment",
  "audioVersion",
  "comment",
  "savedView",
  "shareLink",
  "member",
  "relationType",
  "priorityLevel",
  "field",
  "fieldOption",
  "machine",
  "account",
] as const;

export const DELETE_KIND_LABELS: Readonly<
  Record<(typeof DELETE_KINDS)[number], string>
> = {
  project: "Projects",
  collection: "Collections",
  track: "Tracks",
  session: "Sessions",
  note: "Notes",
  status: "Statuses",
  label: "Labels",
  file: "Files",
  attachment: "Attachments",
  audioVersion: "Audio versions",
  comment: "Comments",
  savedView: "Saved views",
  shareLink: "Share links",
  member: "Members",
  relationType: "Relation types",
  priorityLevel: "Priority levels",
  field: "Custom fields",
  fieldOption: "Field options",
  machine: "Machines",
  account: "Your account",
};

export const group = defineGroup({
  id: "feedback",
  section: "personal",
  label: "Feedback",
  description: "Haptics, toasts, and which deletes ask first.",
  order: 90,
});

export const settings = [
  defineSetting({
    key: "feedback.haptics",
    group: "feedback",
    label: "Haptics",
    description: "A press, a tab or a toast buzzes a touch device.",
    keywords: ["vibrate", "vibration", "touch", "phone"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "feedback.toastDuration",
    group: "feedback",
    label: "Toast duration",
    description: "How long a notice stays up.",
    keywords: ["toast", "notification", "message"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(1).max(30),
    default: 4,
    control: { kind: "duration", unit: "s", min: 1, max: 30 },
    audience: "all",
  }),
  defineSetting({
    key: "feedback.toastPosition",
    group: "feedback",
    label: "Toast position",
    description: "Which corner or edge notices appear at.",
    keywords: ["toast", "notification", "corner"],
    scopes: ["user", "instance"],
    schema: z.enum([
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]),
    default: "bottom-right",
    control: {
      kind: "select",
      options: optionsOf({
        "top-left": "Top left",
        "top-center": "Top centre",
        "top-right": "Top right",
        "bottom-left": "Bottom left",
        "bottom-center": "Bottom centre",
        "bottom-right": "Bottom right",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "feedback.confirmDeletes",
    group: "feedback",
    label: "Ask before deleting",
    description:
      "Which deletes ask first. One switched off deletes at once, with Undo where there is one.",
    keywords: ["confirm", "delete", "dialog", "warning"],
    scopes: ["user", "instance"],
    // Only the kinds switched off need storing: a kind missing asks.
    schema: z.partialRecord(z.enum(DELETE_KINDS), z.boolean()),
    default: {},
    control: {
      kind: "custom",
      component: "delete-confirms",
      options: optionsOf(DELETE_KIND_LABELS),
    },
    audience: "all",
  }),
  defineSetting({
    key: "feedback.undoWindow",
    group: "feedback",
    label: "Undo window",
    description: "How long a notice offering Undo stays up.",
    keywords: ["undo", "toast", "revert"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(1).max(60),
    default: 4,
    control: { kind: "duration", unit: "s", min: 1, max: 60 },
    audience: "all",
  }),
];
