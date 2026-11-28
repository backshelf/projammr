import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { arrangedList, optionsOf } from "../options.js";

/** The sidebar's sections, in song-first order. */
export const SIDEBAR_SECTIONS = [
  "collections",
  "tracks",
  "studio",
  "notebook",
] as const;

/** The phone tab bar's tabs, in song-first order (`studio` is opt-in). */
export const DOCK_TABS = [
  "home",
  "collections",
  "tracks",
  "notes",
  "search",
  "studio",
] as const;

export const group = defineGroup({
  id: "layout",
  section: "personal",
  label: "Layout",
  description: "The sidebar and the phone's tab bar.",
  order: 60,
});

export const settings = [
  defineSetting({
    key: "layout.sidebarWidth",
    group: "layout",
    label: "Sidebar width",
    description: "How wide the sidebar is on a desktop.",
    keywords: ["sidebar", "navigation", "width"],
    scopes: ["user", "instance"],
    schema: z.number().min(12).max(24),
    default: 16,
    control: { kind: "slider", min: 12, max: 24, step: 1, unit: "rem" },
    audience: "all",
  }),
  defineSetting({
    key: "layout.recentItems",
    group: "layout",
    label: "Recent items",
    description:
      "How many recently edited tracks, sessions and notes the sidebar and the palette list.",
    keywords: ["recent", "history", "sidebar", "palette"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(0).max(20),
    default: 5,
    control: { kind: "number", min: 0, max: 20, step: 1 },
    audience: "all",
  }),
  defineSetting({
    key: "layout.recentsSkipArchived",
    group: "layout",
    label: "Leave archived out of recents",
    description:
      "Archived tracks, and their sessions, stay out of the recently edited lists.",
    keywords: ["archived", "recent", "hide"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "layout.sidebarSections",
    group: "layout",
    label: "Sidebar sections",
    description: "Which sections the sidebar shows, in what order.",
    keywords: ["sidebar", "order", "hide", "collapse"],
    scopes: ["user", "instance"],
    schema: arrangedList(
      z.object({
        id: z.enum(SIDEBAR_SECTIONS),
        shown: z.boolean(),
        collapsed: z.boolean(),
      })
    ),
    default: SIDEBAR_SECTIONS.map((id) => ({
      id,
      shown: true,
      collapsed: id === "studio",
    })),
    control: {
      kind: "custom",
      component: "ordered-list",
      options: optionsOf({
        collections: "Collections",
        tracks: "Tracks",
        studio: "Studio / DAW",
        notebook: "Notebook",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "layout.sidebarCollectionOrder",
    group: "layout",
    label: "Collection order",
    description: "How the sidebar orders a project's collections.",
    keywords: ["sort", "collections", "sidebar"],
    scopes: ["user", "instance"],
    schema: z.enum(["release", "title", "edited"]),
    default: "release",
    control: {
      kind: "select",
      options: optionsOf({
        release: "Newest release first",
        title: "By title",
        edited: "Recently edited first",
      }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "layout.dockTabs",
    group: "layout",
    label: "Phone tabs",
    description: "Which tabs the phone's tab bar shows, in what order.",
    keywords: ["dock", "tab bar", "phone", "mobile"],
    scopes: ["user", "instance"],
    schema: arrangedList(
      z.object({ id: z.enum(DOCK_TABS), shown: z.boolean() })
    ),
    default: DOCK_TABS.map((id) => ({ id, shown: id !== "studio" })),
    control: {
      kind: "custom",
      component: "ordered-list",
      options: optionsOf({
        home: "Home",
        collections: "Collections",
        tracks: "Tracks",
        notes: "Notes",
        search: "Search",
        studio: "Studio",
      }),
    },
    audience: "all",
  }),
];
