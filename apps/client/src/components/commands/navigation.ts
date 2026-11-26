import { defineCommands, GLOBAL } from "@/components/commands/define";
import type { ActionContext } from "@/components/commands/types";
import type { ParsedRoute } from "@/lib/route-parser";
import { SETTINGS_HREF } from "@/lib/settings/href";
import { hrefFromParsedRoute, NEW_NOTE_HREF, NOTES_HREF } from "@/lib/utils";
import {
  IconArchive,
  IconDisc,
  IconFileMusic,
  IconFileText,
  IconMusic,
  IconNotebook,
  IconPlug,
  IconSettings,
  IconWaveSine,
} from "@tabler/icons-react";

/** `route` only makes sense with a project to scope it to — a no-op with no
 *  project keeps this safe even if `when` is ever wrong. */
function goTo(route: ParsedRoute) {
  return (ctx: ActionContext) => {
    if (ctx.projectId === null) return;
    ctx.router.push(hrefFromParsedRoute(route, ctx.projectId));
  };
}

const inProject = (ctx: ActionContext) => ctx.projectId !== null;

/** The `g` chords and the palette's destinations, and the `n` chords that
 *  open a new-record form. */
export const NAVIGATION_COMMANDS = defineCommands(GLOBAL, [
  {
    id: "go-to-project",
    label: "Project",
    group: "Go to",
    keys: ["g p"],
    when: inProject,
    run: goTo({ kind: "project" }),
    palette: { icon: IconFileMusic },
  },
  {
    id: "go-to-collections",
    label: "Collections",
    group: "Go to",
    keys: ["g c"],
    when: inProject,
    run: goTo({ kind: "collection-all" }),
  },
  {
    id: "go-to-tracks",
    label: "Tracks",
    group: "Go to",
    keys: ["g t"],
    when: inProject,
    run: goTo({ kind: "track-all" }),
  },
  {
    id: "go-to-sessions",
    label: "Sessions",
    group: "Go to",
    keys: ["g s"],
    when: inProject,
    run: goTo({ kind: "session-all" }),
  },
  {
    id: "go-to-archived-tracks",
    label: "Archived tracks",
    group: "Go to",
    keys: ["g a"],
    when: inProject,
    run: goTo({ kind: "track-archived" }),
    palette: { icon: IconArchive },
  },
  {
    id: "go-to-samples",
    label: "Samples",
    group: "Go to",
    keys: ["g l"],
    when: inProject,
    run: goTo({ kind: "samples" }),
    palette: { icon: IconWaveSine },
  },
  {
    id: "go-to-plugins",
    label: "Plugins",
    group: "Go to",
    keys: ["g u"],
    when: inProject,
    run: goTo({ kind: "plugins" }),
    palette: { icon: IconPlug },
  },
  {
    id: "go-to-settings",
    label: "Settings",
    group: "Go to",
    keys: ["g ,"],
    run: (ctx) => ctx.router.push(SETTINGS_HREF),
    palette: { icon: IconSettings },
  },
  {
    id: "go-to-notebook",
    label: "Notebook",
    group: "Go to",
    keys: ["g n"],
    run: (ctx) => ctx.router.push(NOTES_HREF),
    palette: { icon: IconNotebook },
  },
  {
    id: "new-track",
    label: "Track",
    group: "New",
    keys: ["n t"],
    when: inProject,
    run: goTo({ kind: "track-new" }),
    palette: { icon: IconMusic },
  },
  {
    id: "new-collection",
    label: "Collection",
    group: "New",
    keys: ["n c"],
    when: inProject,
    run: goTo({ kind: "collection-new" }),
    palette: { icon: IconFileMusic },
  },
  {
    id: "new-session",
    label: "Session",
    group: "New",
    keys: ["n s"],
    when: inProject,
    run: goTo({ kind: "session-new" }),
    palette: { icon: IconDisc },
  },
  {
    id: "new-note",
    label: "Note",
    group: "New",
    keys: ["n n"],
    run: (ctx) => ctx.router.push(NEW_NOTE_HREF),
    palette: { icon: IconFileText },
  },
]);
