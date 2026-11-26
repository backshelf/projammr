import { defineCommands, defineScope } from "@/components/commands/define";
import type { CommandContext } from "@/components/commands/types";

/** The controls on an entity page that register a key handler by name. */
export type EntityKeyName = "rename" | "comment" | "upload" | "delete";

/** What a push of the entity scope attaches: where the running order goes
 *  from here, and the handlers the page's controls have registered. */
export type EntitySurface = {
  /** The previous track in the running order, or null at its start. */
  previousHref: string | null;
  /** The next track in the running order, or null at its end. */
  nextHref: string | null;
  /** The handler mounted under `name`, if the control is on the page. */
  handler: (name: EntityKeyName) => (() => void) | undefined;
};

/** The keys that run what a control registered under `name`. */
const CONTROL_KEYS: {
  name: EntityKeyName;
  id: string;
  label: string;
  keys: string[];
}[] = [
  { name: "rename", id: "rename-track", label: "Rename track", keys: ["r"] },
  {
    name: "comment",
    id: "comment-on-audio",
    label: "Comment on the audio",
    keys: ["c"],
  },
  { name: "upload", id: "upload-audio", label: "Upload audio", keys: ["a"] },
  {
    name: "delete",
    id: "delete-track",
    label: "Delete track",
    keys: ["mod+Backspace"],
  },
];

/** The keys that open the palette in a prefix command's mode, to change the
 *  track's status, priority or labels. */
const PALETTE_KEYS = [
  { id: "set-status", label: "Set status", keys: ["s"], seed: "status " },
  { id: "set-priority", label: "Set priority", keys: ["!"], seed: "priority " },
  { id: "set-labels", label: "Add label", keys: ["t"], seed: "label " },
];

/** Pushed while a track page is mounted. */
export const ENTITY_SCOPE = defineScope<EntitySurface>("entity");

/** The keys of a track page: its running order, and what its controls
 *  register. */
export const ENTITY_COMMANDS = defineCommands(ENTITY_SCOPE, [
  {
    id: "previous-track",
    label: "Previous track",
    group: "Track",
    keys: ["{"],
    when: (ctx) => ctx.surface.previousHref !== null,
    run: (ctx) => {
      if (ctx.surface.previousHref !== null)
        ctx.router.push(ctx.surface.previousHref);
    },
  },
  {
    id: "next-track",
    label: "Next track",
    group: "Track",
    keys: ["}"],
    when: (ctx) => ctx.surface.nextHref !== null,
    run: (ctx) => {
      if (ctx.surface.nextHref !== null) ctx.router.push(ctx.surface.nextHref);
    },
  },
  ...PALETTE_KEYS.map(({ id, label, keys, seed }) => ({
    id,
    label,
    group: "Track" as const,
    keys,
    when: (ctx: CommandContext<EntitySurface>) =>
      ctx.canEdit && ctx.projectId !== null && ctx.route.kind === "track",
    run: (ctx: CommandContext<EntitySurface>) => ctx.palette.openWith(seed),
  })),
  ...CONTROL_KEYS.map(({ name, id, label, keys }) => ({
    id,
    label,
    group: "Track" as const,
    keys,
    when: (ctx: CommandContext<EntitySurface>) =>
      ctx.surface.handler(name) !== undefined,
    run: (ctx: CommandContext<EntitySurface>) => ctx.surface.handler(name)?.(),
  })),
]);
