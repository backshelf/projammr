import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { allShown, arrangedList, optionsOf } from "../options.js";

/**
 * The project home's sections, top to bottom. `overview` is the description
 * beside the artwork, `add` the line gathering every empty section's add
 * action, `activity` the feed at the foot of the page.
 */
export const PROJECT_HOME_SECTIONS = [
  "new",
  "quiet",
  "jobs",
  "recent-activity",
  "overview",
  "collections",
  "plugins",
  "samples",
  "heatmap",
  "links",
  "attachments",
  "comments",
  "add",
  "activity",
] as const;

/** A collection page's sections, top to bottom. */
export const COLLECTION_PAGE_SECTIONS = [
  "overview",
  "tracks",
  "repositories",
  "attachments",
  "comments",
  "add",
  "activity",
] as const;

/** A track page's sections below its audio, top to bottom. */
export const TRACK_PAGE_SECTIONS = [
  "overview",
  "lyrics",
  "sessions",
  "repositories",
  "relations",
  "attachments",
  "comments",
  "add",
  "activity",
] as const;

/** A session page's sections, top to bottom. */
export const SESSION_PAGE_SECTIONS = [
  "notes",
  "structure",
  "attachments",
  "samples",
  "history",
  "comments",
  "add",
] as const;

/** Every section's name, across the pages that share some. */
const SECTION_LABELS = {
  new: "New",
  quiet: "Gone quiet",
  jobs: "Jobs",
  "recent-activity": "Recent activity",
  overview: "Overview",
  collections: "Collections",
  plugins: "Plugins",
  samples: "Samples",
  heatmap: "Work heatmap",
  links: "Links",
  attachments: "Attachments",
  comments: "Comments",
  add: "Add",
  activity: "Activity",
  tracks: "Tracks",
  lyrics: "Lyrics",
  sessions: "Sessions",
  repositories: "Repositories",
  relations: "Relations",
  notes: "Notes",
  structure: "Structure",
  history: "History",
} as const;

type SectionId = keyof typeof SECTION_LABELS;

/** A page's sections as a list the viewer arranges, labelled. */
function sectionList<const Id extends SectionId>(ids: readonly [Id, ...Id[]]) {
  return {
    schema: arrangedList(z.object({ id: z.enum(ids), shown: z.boolean() })),
    default: allShown(ids),
    control: {
      kind: "custom",
      component: "ordered-list",
      options: ids.map((id) => ({ value: id, label: SECTION_LABELS[id] })),
    },
  } as const;
}

export const group = defineGroup({
  id: "pages",
  section: "personal",
  label: "Pages",
  description:
    "The sections each page shows, what the inventories open on, and what happens after you create something.",
  order: 70,
});

export const settings = [
  defineSetting({
    key: "pages.projectHomeSections",
    group: "pages",
    label: "Project home",
    description: "The sections a project's home shows, in what order.",
    keywords: ["project", "home", "sections", "order", "hide"],
    scopes: ["user", "instance"],
    ...sectionList(PROJECT_HOME_SECTIONS),
    audience: "all",
  }),
  defineSetting({
    key: "pages.collectionSections",
    group: "pages",
    label: "Collection page",
    description: "The sections a collection's page shows, in what order.",
    keywords: ["collection", "sections", "order", "hide"],
    scopes: ["user", "instance"],
    ...sectionList(COLLECTION_PAGE_SECTIONS),
    audience: "all",
  }),
  defineSetting({
    key: "pages.trackSections",
    group: "pages",
    label: "Track page",
    description: "The sections under a track's audio, in what order.",
    keywords: ["track", "sections", "order", "hide"],
    scopes: ["user", "instance"],
    ...sectionList(TRACK_PAGE_SECTIONS),
    audience: "all",
  }),
  defineSetting({
    key: "pages.sessionSections",
    group: "pages",
    label: "Session page",
    description: "The sections a session's page shows, in what order.",
    keywords: ["session", "sections", "order", "hide"],
    scopes: ["user", "instance"],
    ...sectionList(SESSION_PAGE_SECTIONS),
    audience: "all",
  }),
  defineSetting({
    key: "pages.pluginsOrigin",
    group: "pages",
    label: "Plugins page lists",
    description: "Which devices the plugins page lists when it opens.",
    keywords: ["plugins", "inventory", "devices", "builtin"],
    scopes: ["user", "instance"],
    schema: z.enum(["all", "builtin", "plugin"]),
    default: "all",
    control: {
      kind: "select",
      options: optionsOf({
        all: "Every device",
        builtin: "Built-in devices",
        plugin: "Third-party plugins",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "pages.pluginsStock",
    group: "pages",
    label: "Plugins page draws the stock chain",
    description:
      "Whether the plugins page draws the stock chain when it opens.",
    keywords: ["plugins", "stock", "chain", "inventory"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "pages.samplesShow",
    group: "pages",
    label: "Samples page lists",
    description: "Which samples the samples page lists when it opens.",
    keywords: ["samples", "missing", "inventory"],
    scopes: ["user", "instance"],
    schema: z.enum(["all", "missing"]),
    default: "all",
    control: {
      kind: "select",
      options: optionsOf({ all: "Every sample", missing: "Missing ones" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "pages.samplesLibrary",
    group: "pages",
    label: "Samples page lists library samples",
    description:
      "Whether Core Library, pack and User Library samples are listed when the page opens.",
    keywords: ["samples", "library", "packs", "inventory"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "pages.samplesStock",
    group: "pages",
    label: "Samples page draws the stock chain",
    description:
      "Whether the samples page draws the stock chain when it opens.",
    keywords: ["samples", "stock", "chain", "inventory"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "pages.afterCreate",
    group: "pages",
    label: "After creating",
    description: "What a create form does once the new record exists.",
    keywords: ["create", "new", "form", "redirect"],
    scopes: ["user", "instance"],
    schema: z.enum(["open", "stay", "add-another"]),
    default: "open",
    control: {
      kind: "select",
      options: optionsOf({
        open: "Open it",
        stay: "Stay where I was",
        "add-another": "Add another",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "pages.audioCommentPinned",
    group: "pages",
    label: "Pin comments to the playhead",
    description:
      "A new comment on the audio that is playing starts pinned to where it is.",
    keywords: ["comment", "timestamp", "playhead", "pin"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
];
