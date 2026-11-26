import type { useCommandPalette } from "@/components/command-palette/command-palette-context";
import type { useNowPlaying } from "@/components/music-player/now-playing-context";
import type {
  PlayerActions,
  PlayerStore,
} from "@/components/music-player/player-store";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { ThemeState } from "@/components/theme/AppThemeProvider";
import type { LabSettings } from "@/lib/dsp/lab-settings";
import type { PlaybackPolicy } from "@/lib/policies/playback";
import type { ParsedRoute } from "@/lib/route-parser";
import type { Formatters } from "@workspace/ui/lib/formatters";
import type { Combo } from "@workspace/ui/lib/keymap";
import type { useRouter } from "next/navigation";
import type { ComponentType, Dispatch, SetStateAction } from "react";

/** A track page's track as the palette's recents know it. */
export type RouteTrack = {
  id: number;
  /** Absent when the summaries do not have the track yet. */
  title?: string;
  archived: boolean;
};

/**
 * Everything a command reads when it runs: the route, the player, the theme
 * and the app's surfaces. `CommandProvider` builds it once for every command,
 * whichever surface (a key, the palette, the bar) runs it.
 */
export type ActionContext = {
  router: ReturnType<typeof useRouter>;
  pathname: string;
  /** `null` outside a project — the note actions and prefix command work
   *  from anywhere, but everything project-scoped gates on this. */
  projectId: number | null;
  route: ParsedRoute;
  resolvedTheme: ThemeState["resolvedTheme"];
  setTheme: ThemeState["setTheme"];
  /** The player store, for what a command reads at the moment it runs (the
   *  position, the loaded track) without the context re-rendering on it. */
  player: PlayerStore;
  playerActions: PlayerActions;
  currentTrack: MusicPlayerTrack | null;
  duration: number;
  /** Whether the primary pointer is coarse — gates actions with no
   *  touchscreen equivalent, such as the keyboard shortcuts overlay. */
  coarsePointer: boolean;
  /** The "Keyboard shortcuts" overlay's open state, owned by the provider. */
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  /** The command palette's open state. */
  palette: ReturnType<typeof useCommandPalette>;
  /** The now-playing sheet: whether it shows, and which pane. */
  nowPlaying: ReturnType<typeof useNowPlaying>;
  /** The Lab's current settings, for the `lab ` command to read an
   *  audition's state before it decides which way to toggle it. */
  labSettings: LabSettings;
  /** Opens the now-playing sheet on the Lab view. */
  openLab: () => void;
  /** Whether the viewer is an editor or above in the route's project;
   *  `false` outside a project or until the palette's recents publish it. */
  canEdit: boolean;
  /** The track the route names, `null` off a track page or until the
   *  palette's recents publish the project's tracks. */
  routeTrack: RouteTrack | null;
  /** How long an action's Undo stays on offer: the feedback policy's undo
   *  window. */
  undoWindowMs: number;
  /** How many rows a prefix command offers at most: the shell policy's
   *  result cap. */
  resultCap: number;
  /** The viewer's formatter set, for a row that names a value. */
  formatters: Formatters;
  /** The playback policy, for which version of a track the play commands
   *  queue and how far the seek keys move. */
  playback: PlaybackPolicy;
  /** Toggles the app sidebar open or closed. */
  toggleSidebar: () => void;
};

/** What a command's `when` and `run` receive. */
export type CommandContext<Surface = unknown> = ActionContext & {
  /** The count typed in front of a countable command's key; 1 otherwise. */
  count: number;
  /** Runs the last `repeatable` command again with its count, when it is
   *  available now; does nothing otherwise. */
  repeatLast: () => void;
  /** What the innermost push of the command's scope attached; `undefined`
   *  for a global command. */
  surface: Surface;
};

/**
 * The headings commands are listed under, in the palette and the shortcuts
 * overlay alike.
 */
type CommandGroup =
  | "Playback"
  | "Queue"
  | "General"
  | "Go to"
  | "New"
  | "Help"
  | "Table"
  | "Notebook"
  | "Lab"
  | "Track";

/**
 * One thing the app can do, declared once: the keys that run it, where it
 * answers, when it is available and whether the palette offers it.
 */
export type Command = {
  id: string;
  label: string;
  group: CommandGroup;
  keys?: readonly Combo[];
  /** The scope the keys answer in; the global scope when absent. */
  scope?: string;
  /** Scopes the keys also answer in. Only where they answer widens: the
   *  command's surface and availability stay those of `scope`. */
  alsoIn?: readonly string[];
  /** While false the command is unavailable: not dispatched, greyed in the
   *  overlay, absent from the palette. */
  when?(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void | Promise<void>;
  /** Present when the palette offers the command, with the row's icon.
   *  `hidden` keeps it out of the empty query's list: a query still finds it. */
  palette?: {
    icon: ComponentType<{ className?: string }>;
    hidden?: boolean;
  };
  /** Takes a count typed in front of its key (`5j`). */
  countable?: boolean;
  /** A digit key that stands aside while the digit builds a count for a
   *  countable command (seek-to-tenth on a list page). */
  yieldsToCount?: boolean;
  /** `.` (repeat last command) may run it again. */
  repeatable?: boolean;
  /** Fires even while a text field has focus. */
  allowInInput?: boolean;
};

/** A command as a list reads it: its effective keys and whether it can run. */
export type ListedCommand = Command & {
  /** The keys that run it now, overrides applied, canonical. */
  keys: readonly Combo[];
  available: boolean;
};
