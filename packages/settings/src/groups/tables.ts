import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

/**
 * The client's table kinds. Declared here rather than imported from
 * `@workspace/api`, since this package has no dependency on it.
 */
export const TABLE_KINDS = ["track", "collection", "session"] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

const TABLE_KIND_LABELS: Readonly<Record<TableKind, string>> = {
  track: "Tracks",
  collection: "Collections",
  session: "Sessions",
};

/** The kinds with a board view (a status to lay out by): tracks and collections. */
const BOARD_KINDS = [
  "track",
  "collection",
] as const satisfies readonly TableKind[];

/** Every scope but `tables.defaultSavedView`, which is user-only (see below). */
const CASCADE_SCOPES = ["user", "project", "instance"] as const;

export const group = defineGroup({
  id: "tables",
  section: "personal",
  label: "Tables",
  description:
    "Each table's default columns, sort, grouping and view, and how a row behaves.",
  order: 75,
});

/** One kind's `Columns`, `Sort` and `Grouping` keys. */
function kindSettings(kind: TableKind) {
  const label = TABLE_KIND_LABELS[kind];
  const lower = label.toLowerCase();
  return [
    defineSetting({
      key: `tables.${kind}Columns`,
      group: "tables",
      label: `${label}: columns`,
      description: `Which columns the ${lower} table shows by default, in the same vocabulary as its URL's \`cols\`.`,
      keywords: ["columns", "visibility", "hide", "show", kind],
      scopes: CASCADE_SCOPES,
      schema: z.record(z.string(), z.boolean()),
      default: {},
      control: { kind: "custom", component: "table-columns" },
      audience: "all",
    }),
    defineSetting({
      key: `tables.${kind}Sort`,
      group: "tables",
      label: `${label}: sort`,
      description: `The ${lower} table's default sort, spelled like its URL's \`sort\`.`,
      keywords: ["sort", "order", kind],
      scopes: CASCADE_SCOPES,
      schema: z.string(),
      default: "",
      control: { kind: "custom", component: "table-sort" },
      audience: "all",
    }),
    defineSetting({
      key: `tables.${kind}Grouping`,
      group: "tables",
      label: `${label}: grouping`,
      description: `The column the ${lower} table groups its rows by, when a view does not say otherwise.`,
      keywords: ["grouping", "group by", kind],
      scopes: CASCADE_SCOPES,
      schema: z.string(),
      default: "",
      control: { kind: "custom", component: "table-grouping" },
      audience: "all",
    }),
  ];
}

/**
 * A board kind's `View` key. Kept out of {@link kindSettings} so its return
 * type only ever names `track`/`collection` — folding it into a conditional
 * branch there once made every kind's key type include `tables.sessionView`,
 * since a function's return type covers every branch it could take, not just
 * the one a given call site's argument narrows to.
 */
function boardViewSetting(kind: (typeof BOARD_KINDS)[number]) {
  const label = TABLE_KIND_LABELS[kind];
  const lower = label.toLowerCase();
  return defineSetting({
    key: `tables.${kind}View`,
    group: "tables",
    label: `${label}: view`,
    description: `Which surface the ${lower} table opens on.`,
    keywords: ["view", "board", "list", kind],
    scopes: CASCADE_SCOPES,
    schema: z.enum(["list", "board"]),
    default: "list",
    control: {
      kind: "select",
      options: optionsOf({ list: "List", board: "Board" }),
    },
    audience: "all",
  });
}

export const settings = [
  ...TABLE_KINDS.flatMap(kindSettings),
  ...BOARD_KINDS.map(boardViewSetting),
  defineSetting({
    key: "tables.archived",
    group: "tables",
    label: "Archived tracks",
    description:
      "Whether the tracks table's default view hides, includes, or shows only archived tracks.",
    keywords: ["archived", "archive", "tracks"],
    scopes: CASCADE_SCOPES,
    schema: z.enum(["hide", "include", "only"]),
    default: "hide",
    control: {
      kind: "select",
      options: optionsOf({
        hide: "Hidden",
        include: "Included",
        only: "Archived only",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "tables.defaultSavedView",
    group: "tables",
    label: "Default saved views",
    description:
      "Which saved view each table opens on by default, per project. Set from a table's Views menu.",
    keywords: ["saved view", "default", "views"],
    // A per-project default at user scope has no place in the ordinary
    // cascade (project scope would shadow every project's default at once),
    // so this key is user-only and shaped as a projectId -> kind -> saved
    // view id map instead. The per-kind sort/columns/view/grouping keys above
    // still cascade user > project > instance for a project's conventions.
    scopes: ["user"],
    schema: z.record(
      z.string(),
      z.partialRecord(z.enum(TABLE_KINDS), z.number().int())
    ),
    default: {},
    control: { kind: "custom", component: "table-default-views" },
    audience: "all",
  }),
  defineSetting({
    key: "tables.rowsPerLoad",
    group: "tables",
    label: "Rows per load",
    description:
      "How many rows a table's first page and each load-more fetch, up to the server's cap.",
    keywords: ["rows", "page size", "load more", "pagination"],
    scopes: CASCADE_SCOPES,
    schema: z.number().int().min(10).max(200),
    default: 50,
    control: { kind: "number", min: 10, max: 200, step: 10 },
    audience: "all",
  }),
  defineSetting({
    key: "tables.thumbnails",
    group: "tables",
    label: "Thumbnails",
    description: "Whether a table's title column shows cover art.",
    keywords: ["thumbnails", "artwork", "cover", "image"],
    scopes: CASCADE_SCOPES,
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "tables.pinnedIdentityColumn",
    group: "tables",
    label: "Pin the title column",
    description:
      "Whether a table's identity column (title or name) stays pinned while scrolling.",
    keywords: ["pin", "sticky", "title", "column"],
    scopes: CASCADE_SCOPES,
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "tables.hoverPlay",
    group: "tables",
    label: "Play button",
    description: "Whether a row's play button shows only on hover or always.",
    keywords: ["hover", "play", "hoverplay"],
    scopes: CASCADE_SCOPES,
    schema: z.enum(["hover", "always"]),
    default: "hover",
    control: {
      kind: "select",
      options: optionsOf({ hover: "On hover", always: "Always" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "tables.rowClick",
    group: "tables",
    label: "Row click",
    description:
      "Whether clicking a row opens its page or peeks it in a side panel.",
    keywords: ["row click", "peek", "open", "navigate"],
    scopes: CASCADE_SCOPES,
    schema: z.enum(["open", "peek"]),
    default: "peek",
    control: {
      kind: "select",
      options: optionsOf({ open: "Opens the page", peek: "Peeks the row" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "tables.dateColumns",
    group: "tables",
    label: "Date columns",
    description:
      "Whether a table's date columns show a relative time or an absolute date.",
    keywords: ["date", "time", "relative", "absolute"],
    scopes: CASCADE_SCOPES,
    schema: z.enum(["relative", "absolute"]),
    default: "relative",
    control: {
      kind: "select",
      options: optionsOf({ relative: "Relative", absolute: "Absolute" }),
    },
    audience: "all",
  }),
];
