import type { SearchResult } from "@/components/command-palette/use-search";
import { clientSearchProject } from "@/components/command-palette/use-search";
import {
  resolveSetField as resolveSetFieldChoices,
  settableFields,
} from "@/components/command-palette/set-field";
import { getCustomFields } from "@/actions/custom-fields";
import { getLabels } from "@/actions/labels";
import { getMyNotes } from "@/actions/notes";
import { patchField } from "@/actions/patch-field";
import { getPriorityLevels } from "@/actions/priorities";
import { getStatuses } from "@/actions/statuses";
import { getTrackLabels } from "@/actions/tracks";
import { trackToPlayable } from "@/components/music-player/play-track";
import type { ActionContext } from "@/components/commands/types";
import {
  LAB_AUDITIONS,
  labAuditionOn,
  toggleLabAudition,
  type LabAuditionKey,
} from "@/lib/dsp/lab-auditions";
import {
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
} from "@/lib/dsp/lab-settings";
import type { PalettePrefixCommand } from "@workspace/settings/groups/palette";
import { ENTITIES } from "@/entities";
import { setEntityLabels } from "@/entities/mutations";
import { applyMutation } from "@/lib/mutation";
import { settingsHref } from "@/lib/settings/href";
import {
  hrefFromParsedRoute,
  noteHref,
  noteMatches,
  noteTitle,
} from "@/lib/utils";
import {
  IconArrowRight,
  IconArrowsUpDown,
  IconCornerDownRight,
  IconFilter,
  IconFlag,
  IconFlask,
  IconMusic,
  IconDisc,
  IconNotebook,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconPlaylistAdd,
  IconSun,
  IconTag,
  IconTagOff,
  IconVolume,
  IconGauge,
  IconForms,
} from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { THEMES } from "@workspace/settings/appearance";
import type { ComponentType } from "react";
import { toast } from "sonner";

const isInProject = (ctx: ActionContext) => ctx.projectId !== null;

/** Every command with a `group` and `label`, matched by `` `${group} ${label}` ``
 *  so "go to project" and "new track" find their commands under their groups. */
export function matchActions<T extends { group: string; label: string }>(
  commands: readonly T[],
  query: string
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [...commands];
  return commands.filter((command) =>
    `${command.group} ${command.label}`.toLowerCase().includes(trimmed)
  );
}

/**
 * A row a prefix command offers to select. `search` wraps a `SearchResult`
 * from a round trip; `local` is a synchronously computed option — a parsed
 * value, a confirmation, a name from a small fixed or already-loaded list —
 * with nothing to search for.
 */
export type PrefixRow =
  | { kind: "search"; result: SearchResult }
  | { kind: "local"; id: string; title: string; subtitle?: string };

/**
 * A command that consumes the rest of the query as an argument — `play low
 * tide` looks up "low tide" and offers the matching tracks to play, rather
 * than matching a fixed label the way a `CommandAction` does.
 *
 * `resolve` and `run` are split so the round trip (or synchronous lookup) and
 * the thing done with a chosen row stay independent: several commands can
 * resolve the same way and differ only in what they do with the row.
 *
 * `mode: "async"` commands resolve over a debounced, abortable round trip
 * (typically a search request) — `resolve` returns a promise and is only
 * called once the remainder stops changing for a beat. `mode: "sync"`
 * commands compute their rows directly from the remainder on every keystroke
 * — `theme dark` doesn't need a network round trip to know what it means.
 */
export type PrefixCommand = {
  id: PalettePrefixCommand;
  prefix: string;
  group: string;
  icon: ComponentType<{ className?: string }>;
  /** Shown while `resolve` is in flight, and as the heading for its rows. */
  hint: (remainder: string) => string;
  /**
   * What the command does, for the "Commands" group shown when the query
   * doesn't (yet) match a complete prefix — discovery copy, independent of
   * `hint`'s in-progress wording, e.g. "Change this track's status".
   */
  description: string;
  emptyLabel: (remainder: string) => string;
  isAvailable?: (ctx: ActionContext) => boolean;
} & (
  | {
      mode: "async";
      resolve: (
        remainder: string,
        ctx: ActionContext,
        signal: AbortSignal
      ) => Promise<PrefixRow[]>;
    }
  | {
      mode: "sync";
      resolve: (remainder: string, ctx: ActionContext) => PrefixRow[];
    }
) & {
    run: (row: PrefixRow, ctx: ActionContext) => void | Promise<void>;
  };

/** Where a search result in `projectId` navigates to when selected. */
export function resultHref(result: SearchResult, projectId: number): string {
  if (result.type === "asset") {
    return settingsHref({ section: "project", projectId, group: "assets" });
  }
  return hrefFromParsedRoute(
    ENTITIES[result.type].pageRoute(result.id, {}),
    projectId
  );
}

function searchRows(results: SearchResult[]): PrefixRow[] {
  return results.map((result) => ({ kind: "search", result }));
}

/** Unwraps a `PrefixRow` back into the `SearchResult` a search-backed command expects. */
function asSearchResult(row: PrefixRow): SearchResult | null {
  return row.kind === "search" ? row.result : null;
}

async function resolveTracks(
  remainder: string,
  ctx: ActionContext,
  signal: AbortSignal
): Promise<PrefixRow[]> {
  if (ctx.projectId === null) return [];
  const data = await clientSearchProject(ctx.projectId, remainder, signal, {
    types: ["track"],
    limit: ctx.resultCap,
  });
  if (isActionError(data)) return [];
  return searchRows(data.filter((result) => !result.isComment));
}

async function resolveAny(
  remainder: string,
  ctx: ActionContext,
  signal: AbortSignal
): Promise<PrefixRow[]> {
  if (ctx.projectId === null) return [];
  const data = await clientSearchProject(ctx.projectId, remainder, signal, {
    limit: ctx.resultCap,
  });
  if (isActionError(data)) return [];
  return searchRows(data);
}

async function playTrackResult(
  row: PrefixRow,
  playback: ActionContext["playback"]
) {
  const result = asSearchResult(row);
  if (!result) return null;
  const items = await trackToPlayable(result.id, playback, result.title);
  return items && items.length > 0 ? items : null;
}

/**
 * `id` doubles as the value handed to `run` — the row it comes from just
 * confirms a parse, so `run` re-derives the value from `row.id` rather than
 * closing over a variable from `resolve`.
 */
function localRow(id: string, title: string, subtitle?: string): PrefixRow {
  return { kind: "local", id, title, subtitle };
}

function resolveTheme(remainder: string): PrefixRow[] {
  const query = remainder.trim().toLowerCase();
  return THEMES.filter((option) => option.startsWith(query)).map((option) =>
    localRow(option, `${option[0]!.toUpperCase()}${option.slice(1)}`)
  );
}

function parseVolumePercent(remainder: string): number | null {
  const n = Number(remainder.trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

function resolveVolume(remainder: string): PrefixRow[] {
  if (remainder.trim().length === 0) return [];
  const pct = parseVolumePercent(remainder);
  if (pct === null) return [];
  return [localRow(String(pct), `Set volume to ${pct}%`)];
}

function parseSpeed(remainder: string): number | null {
  const n = Number(remainder.trim());
  if (!Number.isFinite(n)) return null;
  if (n < SPEED_MIN || n > SPEED_MAX) return null;
  return n;
}

function resolveSpeed(remainder: string): PrefixRow[] {
  if (remainder.trim().length === 0) return [];
  const speed = parseSpeed(remainder);
  if (speed === null) return [];
  return [localRow(String(speed), `Set playback speed to ${speed}×`)];
}

function parsePitch(remainder: string): number | null {
  const n = Number(remainder.trim());
  if (!Number.isFinite(n)) return null;
  if (n < PITCH_MIN || n > PITCH_MAX) return null;
  return n;
}

function resolvePitch(remainder: string): PrefixRow[] {
  if (remainder.trim().length === 0) return [];
  const pitch = parsePitch(remainder);
  if (pitch === null) return [];
  const sign = pitch > 0 ? "+" : "";
  return [localRow(String(pitch), `Set pitch to ${sign}${pitch} semitones`)];
}

// Re-exported for `action-context.test.ts`, which reaches it through this
// module rather than the registry directly.
export { labAuditionOn };

/**
 * The `lab ` command's vocabulary: every audition a single word can name,
 * read off the shared registry so the palette can't drift from the pills,
 * the hotkeys and the overflow menu.
 */
function resolveLabAudition(
  remainder: string,
  ctx: ActionContext
): PrefixRow[] {
  const query = remainder.trim().toLowerCase();
  return LAB_AUDITIONS.filter((audition) => audition.key.startsWith(query)).map(
    (audition) => {
      const verb = labAuditionOn(ctx.labSettings, audition.key)
        ? "Turn off"
        : "Turn on";
      return localRow(
        audition.key,
        `${verb} ${audition.labelFor({ normaliseTargetLufs: ctx.player.getSnapshot().lab.targetLufs })}`
      );
    }
  );
}

function runLabAudition(row: PrefixRow, ctx: ActionContext) {
  if (row.kind !== "local") return;
  const key = row.id as LabAuditionKey;
  ctx.playerActions.setAudition(toggleLabAudition(ctx.labSettings, key));
}

/** `mm:ss` (or bare seconds) as whole seconds, or null if unparseable. */
function parseTimecode(remainder: string): number | null {
  const trimmed = remainder.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTimecode(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolveSeek(remainder: string, ctx: ActionContext): PrefixRow[] {
  if (remainder.trim().length === 0) return [];
  const seconds = parseTimecode(remainder);
  if (seconds === null) return [];
  const clamped =
    ctx.duration > 0 ? Math.min(seconds, Math.floor(ctx.duration)) : seconds;
  return [localRow(String(clamped), `Seek to ${formatTimecode(clamped)}`)];
}

function resolveNewTrack(remainder: string): PrefixRow[] {
  const title = remainder.trim();
  if (title.length === 0) return [];
  return [localRow(title, `Create track “${title}”`)];
}

function resolveNewSession(remainder: string): PrefixRow[] {
  const name = remainder.trim();
  if (name.length === 0) return [];
  return [localRow(name, `Create session “${name}”`)];
}

function resolveFilter(remainder: string): PrefixRow[] {
  const query = remainder.trim();
  if (query.length === 0) return [];
  return [localRow(query, `Filter this list by “${query}”`)];
}

function pushWithParam(ctx: ActionContext, key: string, value: string) {
  const url = new URL(ctx.pathname, "http://placeholder");
  url.searchParams.set(key, value);
  ctx.router.push(`${url.pathname}${url.search}`);
}

async function resolveStatuses(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  if (ctx.projectId === null) return [];
  const statuses = await getStatuses(ctx.projectId);
  if (isActionError(statuses)) return [];
  const query = remainder.trim().toLowerCase();
  return statuses
    .filter((status) => status.name.toLowerCase().includes(query))
    .slice(0, ctx.resultCap)
    .map((status) => localRow(String(status.id), status.name));
}

async function runSetStatus(row: PrefixRow, ctx: ActionContext) {
  if (row.kind !== "local" || ctx.route.kind !== "track") return;
  const result = await patchField(
    "track",
    ctx.route.trackId,
    "statusId",
    Number(row.id)
  );
  if (isActionError(result)) toast.error(result.error);
}

/**
 * The project's levels whose name holds the remainder, in the scale's order
 * with the one named exactly first, so Enter on `priority high` picks High
 * even when "Highest" sits below it.
 */
async function resolvePriorityLevels(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  if (ctx.projectId === null) return [];
  const levels = await getPriorityLevels(ctx.projectId);
  if (isActionError(levels)) return [];
  const query = remainder.trim().toLowerCase();
  const exact = (name: string) => name.toLowerCase() === query;
  return levels
    .filter((level) => level.name.toLowerCase().includes(query))
    .sort((a, b) => Number(exact(b.name)) - Number(exact(a.name)))
    .slice(0, ctx.resultCap)
    .map((level) => localRow(String(level.id), level.name));
}

async function runSetPriority(row: PrefixRow, ctx: ActionContext) {
  if (row.kind !== "local" || ctx.route.kind !== "track") return;
  const result = await patchField(
    "track",
    ctx.route.trackId,
    "priorityId",
    Number(row.id)
  );
  if (isActionError(result)) toast.error(result.error);
}

/** The page's own entity, when it is one whose project can define custom fields. */
function fieldTarget(ctx: ActionContext) {
  if (ctx.route.kind === "track") {
    return { kind: "track" as const, id: ctx.route.trackId };
  }
  if (ctx.route.kind === "collection") {
    return { kind: "collection" as const, id: ctx.route.collectionId };
  }
  return null;
}

/**
 * How `set <field> <value>` can finish on this page: the page entity's title
 * or one of its project's custom fields, with the value parsed by that field's
 * kind. A row carries the write it makes as its id.
 */
async function resolveSetField(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  const target = fieldTarget(ctx);
  if (ctx.projectId === null || target === null) return [];
  const fields = await getCustomFields(ctx.projectId, target.kind);
  return resolveSetFieldChoices(
    remainder,
    settableFields(isActionError(fields) ? [] : fields),
    ctx.formatters
  )
    .slice(0, ctx.resultCap)
    .map(({ key, value, title }) =>
      localRow(JSON.stringify({ key, value }), title)
    );
}

async function runSetField(row: PrefixRow, ctx: ActionContext) {
  const target = fieldTarget(ctx);
  if (row.kind !== "local" || target === null) return;
  const { key, value } = JSON.parse(row.id) as {
    key: string;
    value: string | number | boolean;
  };
  const result = await patchField(target.kind, target.id, key, value);
  if (isActionError(result)) toast.error(result.error);
}

const CREATE_LABEL_PREFIX = "create:";
const EXISTING_LABEL_PREFIX = "existing:";

async function runAddLabel(row: PrefixRow, ctx: ActionContext) {
  if (row.kind !== "local" || ctx.route.kind !== "track") return;
  const trackId = ctx.route.trackId;
  const current = await getTrackLabels(trackId);
  if (isActionError(current)) {
    toast.error(current.error);
    return;
  }

  let result;
  if (row.id.startsWith(EXISTING_LABEL_PREFIX)) {
    const labelId = Number(row.id.slice(EXISTING_LABEL_PREFIX.length));
    if (current.some((l) => l.id === labelId)) return;
    result = await applyMutation(
      setEntityLabels("track", trackId, {
        labelIds: [...current.map((l) => l.id), labelId],
      }),
      ctx.router
    );
  } else if (row.id.startsWith(CREATE_LABEL_PREFIX)) {
    const name = row.id.slice(CREATE_LABEL_PREFIX.length);
    result = await applyMutation(
      setEntityLabels("track", trackId, {
        labelIds: current.map((l) => l.id),
        names: [name],
      }),
      ctx.router
    );
  } else {
    return;
  }
  if (isActionError(result)) toast.error(result.error);
}

async function runRemoveLabel(row: PrefixRow, ctx: ActionContext) {
  if (row.kind !== "local" || ctx.route.kind !== "track") return;
  const trackId = ctx.route.trackId;
  const labelId = Number(row.id);
  const current = await getTrackLabels(trackId);
  if (isActionError(current)) {
    toast.error(current.error);
    return;
  }

  const result = await applyMutation(
    setEntityLabels("track", trackId, {
      labelIds: current.filter((l) => l.id !== labelId).map((l) => l.id),
    }),
    ctx.router
  );
  if (isActionError(result)) toast.error(result.error);
}

/** Existing project labels matching `query`, not already on the track, plus a
 *  trailing "create" row when no existing label matches the query exactly. */
async function resolveLabelCandidates(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  const query = remainder.trim();
  if (query.length === 0 || ctx.route.kind !== "track") return [];
  if (ctx.projectId === null) return [];

  const [vocabulary, current] = await Promise.all([
    getLabels(ctx.projectId),
    getTrackLabels(ctx.route.trackId),
  ]);
  if (isActionError(vocabulary) || isActionError(current)) return [];

  const currentIds = new Set(current.map((l) => l.id));
  const lowerQuery = query.toLowerCase();
  const matches = vocabulary.filter(
    (label) =>
      !currentIds.has(label.id) && label.name.toLowerCase().includes(lowerQuery)
  );

  const rows = matches
    .slice(0, ctx.resultCap)
    .map((label) =>
      localRow(`${EXISTING_LABEL_PREFIX}${label.id}`, label.name)
    );

  const exactMatch = vocabulary.some(
    (label) => label.name.toLowerCase() === lowerQuery
  );
  if (!exactMatch) {
    rows.push(
      localRow(`${CREATE_LABEL_PREFIX}${query}`, `Create and add “${query}”`)
    );
  }

  return rows;
}

/** The track's current labels matching `query`, offered to remove. */
async function resolveUnlabelCandidates(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  const query = remainder.trim().toLowerCase();
  if (ctx.route.kind !== "track") return [];

  const current = await getTrackLabels(ctx.route.trackId);
  if (isActionError(current)) return [];

  return current
    .filter((label) => label.name.toLowerCase().includes(query))
    .slice(0, ctx.resultCap)
    .map((label) => localRow(String(label.id), label.name));
}

/** The signed-in user's notes with a title or preview matching `query`. */
async function resolveNotes(
  remainder: string,
  ctx: ActionContext
): Promise<PrefixRow[]> {
  const query = remainder.trim();
  const notes = await getMyNotes();
  if (isActionError(notes)) return [];

  return notes
    .filter((note) => noteMatches(note, query))
    .slice(0, ctx.resultCap)
    .map((note) =>
      localRow(
        String(note.id),
        noteTitle(note.title),
        note.preview || undefined
      )
    );
}

export const PREFIX_COMMANDS: PrefixCommand[] = [
  // Tier 1 — track resolver, differ only in the verb
  {
    id: "play",
    prefix: "play ",
    group: "Play",
    icon: IconPlayerPlay,
    mode: "async",
    hint: (remainder) => `Play tracks matching “${remainder}”…`,
    description: "Play a track now, replacing the queue",
    emptyLabel: (remainder) => `No tracks matching “${remainder}”`,
    isAvailable: isInProject,
    resolve: resolveTracks,
    run: async (row, ctx) => {
      const items = await playTrackResult(row, ctx.playback);
      if (items) ctx.playerActions.playNow(items);
    },
  },
  {
    id: "queue",
    prefix: "queue ",
    group: "Play",
    icon: IconPlaylistAdd,
    mode: "async",
    hint: (remainder) => `Queue tracks matching “${remainder}”…`,
    description: "Add a track to the end of the queue",
    emptyLabel: (remainder) => `No tracks matching “${remainder}”`,
    isAvailable: isInProject,
    resolve: resolveTracks,
    run: async (row, ctx) => {
      const items = await playTrackResult(row, ctx.playback);
      if (items) ctx.playerActions.enqueue(items);
    },
  },
  {
    id: "playnext",
    prefix: "playnext ",
    group: "Play",
    icon: IconCornerDownRight,
    mode: "async",
    hint: (remainder) => `Play next: tracks matching “${remainder}”…`,
    description: "Play a track immediately after the current one",
    emptyLabel: (remainder) => `No tracks matching “${remainder}”`,
    isAvailable: isInProject,
    resolve: resolveTracks,
    run: async (row, ctx) => {
      const items = await playTrackResult(row, ctx.playback);
      if (items) ctx.playerActions.playNext(items);
    },
  },

  // Tier 2 — different search scope, same machinery
  {
    id: "go",
    prefix: "go ",
    group: "Navigate",
    icon: IconArrowRight,
    mode: "async",
    hint: (remainder) => `Go to “${remainder}”…`,
    description: "Jump to a track, collection, session, or asset",
    emptyLabel: (remainder) => `Nothing matching “${remainder}”`,
    isAvailable: isInProject,
    resolve: resolveAny,
    run: (row, ctx) => {
      const result = asSearchResult(row);
      if (result && ctx.projectId !== null) {
        ctx.router.push(resultHref(result, ctx.projectId));
      }
    },
  },
  {
    id: "note",
    prefix: "note ",
    group: "Notebook",
    icon: IconNotebook,
    mode: "async",
    hint: (remainder) => `Notes matching “${remainder}”…`,
    description: "Jump to a note in your notebook",
    emptyLabel: (remainder) => `No notes matching “${remainder}”`,
    resolve: (remainder, ctx) => resolveNotes(remainder, ctx),
    run: (row, ctx) => {
      if (row.kind === "local") ctx.router.push(noteHref(Number(row.id)));
    },
  },

  // Tier 3 — local, no round trip
  {
    id: "theme",
    prefix: "theme ",
    group: "Actions",
    icon: IconSun,
    mode: "sync",
    hint: () => "Set the theme…",
    description: "Switch between light, dark, and system theme",
    emptyLabel: (remainder) => `No theme matching “${remainder}”`,
    resolve: (remainder) => resolveTheme(remainder),
    run: (row, ctx) => {
      if (row.kind !== "local") return;
      const theme = THEMES.find((option) => option === row.id);
      if (theme) ctx.setTheme(theme);
    },
  },
  {
    id: "volume",
    prefix: "volume ",
    group: "Play",
    icon: IconVolume,
    mode: "sync",
    hint: () => "Set volume to a percentage (0-100)…",
    description: "Set the player's volume to a percentage",
    emptyLabel: (remainder) => `“${remainder}” isn't 0-100`,
    isAvailable: (ctx) => ctx.currentTrack !== null,
    resolve: (remainder) => resolveVolume(remainder),
    run: (row, ctx) => {
      if (row.kind === "local")
        ctx.playerActions.setVolume(Number(row.id) / 100);
    },
  },
  {
    id: "speed",
    prefix: "speed ",
    group: "Play",
    icon: IconGauge,
    mode: "sync",
    hint: () => `Set playback speed (${SPEED_MIN}-${SPEED_MAX})…`,
    description: `Change playback speed (${SPEED_MIN}×-${SPEED_MAX}×)`,
    emptyLabel: (remainder) => `“${remainder}” isn't a valid speed`,
    isAvailable: (ctx) => ctx.currentTrack !== null,
    resolve: (remainder) => resolveSpeed(remainder),
    run: (row, ctx) => {
      if (row.kind === "local") ctx.playerActions.setSpeed(Number(row.id));
    },
  },
  {
    id: "pitch",
    prefix: "pitch ",
    group: "Play",
    icon: IconArrowsUpDown,
    mode: "sync",
    hint: () => `Set pitch in semitones (${PITCH_MIN}-${PITCH_MAX})…`,
    description: `Change pitch (${PITCH_MIN} to ${PITCH_MAX} semitones)`,
    emptyLabel: (remainder) => `“${remainder}” isn't a valid pitch`,
    isAvailable: (ctx) => ctx.currentTrack !== null,
    resolve: (remainder) => resolvePitch(remainder),
    run: (row, ctx) => {
      if (row.kind === "local") ctx.playerActions.setPitch(Number(row.id));
    },
  },
  {
    id: "lab",
    prefix: "lab ",
    group: "Play",
    icon: IconFlask,
    mode: "sync",
    hint: () => "Toggle a Lab audition…",
    description: "Toggle a Lab audition, such as mono or a device impression",
    emptyLabel: (remainder) => `No audition matching “${remainder}”`,
    isAvailable: (ctx) => ctx.currentTrack !== null,
    resolve: (remainder, ctx) => resolveLabAudition(remainder, ctx),
    run: (row, ctx) => runLabAudition(row, ctx),
  },
  {
    id: "seek",
    prefix: "seek ",
    group: "Play",
    icon: IconPlayerTrackNext,
    mode: "sync",
    hint: () => "Seek to a timecode (mm:ss)…",
    description: "Jump the current track to a timecode (mm:ss)",
    emptyLabel: (remainder) => `“${remainder}” isn't a valid timecode`,
    isAvailable: (ctx) => ctx.currentTrack !== null,
    resolve: (remainder, ctx) => resolveSeek(remainder, ctx),
    run: (row, ctx) => {
      if (row.kind === "local") ctx.playerActions.seek(Number(row.id));
    },
  },
  {
    id: "new-track-titled",
    prefix: "new track ",
    group: "Actions",
    icon: IconMusic,
    mode: "sync",
    hint: () => "Create a track with this title…",
    description: "Create a new track, prefilled with the typed title",
    emptyLabel: () => "Type a title",
    isAvailable: isInProject,
    resolve: (remainder) => resolveNewTrack(remainder),
    run: (row, ctx) => {
      if (row.kind !== "local" || ctx.projectId === null) return;
      const href = hrefFromParsedRoute({ kind: "track-new" }, ctx.projectId);
      ctx.router.push(`${href}?title=${encodeURIComponent(row.id)}`);
    },
  },
  {
    id: "new-session-named",
    prefix: "new session ",
    group: "Actions",
    icon: IconDisc,
    mode: "sync",
    hint: () => "Create a session with this name…",
    description: "Create a new session, prefilled with the typed name",
    emptyLabel: () => "Type a name",
    isAvailable: isInProject,
    resolve: (remainder) => resolveNewSession(remainder),
    run: (row, ctx) => {
      if (row.kind !== "local" || ctx.projectId === null) return;
      const href = hrefFromParsedRoute({ kind: "session-new" }, ctx.projectId);
      ctx.router.push(`${href}?name=${encodeURIComponent(row.id)}`);
    },
  },
  {
    id: "filter",
    prefix: "filter ",
    group: "Actions",
    icon: IconFilter,
    mode: "sync",
    hint: () => "Filter the current list…",
    description: "Filter the table on this page by a search term",
    emptyLabel: () => "Type a search term",
    // Every table a query filters is a project's list.
    isAvailable: isInProject,
    resolve: (remainder) => resolveFilter(remainder),
    run: (row, ctx) => {
      if (row.kind === "local") pushWithParam(ctx, "q", row.id);
    },
  },

  // Tier 4 — mutations
  {
    id: "status",
    prefix: "status ",
    group: "Actions",
    icon: IconTag,
    mode: "async",
    hint: (remainder) => `Statuses matching “${remainder}”…`,
    description: "Change this track's status",
    emptyLabel: (remainder) => `No status matching “${remainder}”`,
    isAvailable: (ctx) => ctx.projectId !== null && ctx.route.kind === "track",
    resolve: (remainder, ctx) => resolveStatuses(remainder, ctx),
    run: (row, ctx) => runSetStatus(row, ctx),
  },
  {
    id: "priority",
    prefix: "priority ",
    group: "Actions",
    icon: IconFlag,
    mode: "async",
    hint: (remainder) => `Priority levels matching “${remainder}”…`,
    description: "Change this track's priority",
    emptyLabel: (remainder) => `No priority level matching “${remainder}”`,
    isAvailable: (ctx) => ctx.projectId !== null && ctx.route.kind === "track",
    resolve: (remainder, ctx) => resolvePriorityLevels(remainder, ctx),
    run: (row, ctx) => runSetPriority(row, ctx),
  },
  {
    id: "set-field",
    prefix: "set ",
    group: "Actions",
    icon: IconForms,
    mode: "async",
    hint: (remainder) => `Setting “${remainder}”…`,
    description: "Set a field on this page, like “set energy 7”",
    emptyLabel: (remainder) =>
      `No field and value matching “${remainder}”; a name in quotes reaches a custom field`,
    isAvailable: (ctx) => ctx.projectId !== null && fieldTarget(ctx) !== null,
    resolve: (remainder, ctx) => resolveSetField(remainder, ctx),
    run: (row, ctx) => runSetField(row, ctx),
  },
  {
    id: "label",
    prefix: "label ",
    group: "Actions",
    icon: IconTag,
    mode: "async",
    hint: (remainder) => `Labels matching “${remainder}”…`,
    description: "Add an existing label to this track, or create a new one",
    emptyLabel: () => "Type a label name",
    isAvailable: (ctx) => ctx.projectId !== null && ctx.route.kind === "track",
    resolve: (remainder, ctx) => resolveLabelCandidates(remainder, ctx),
    run: (row, ctx) => runAddLabel(row, ctx),
  },
  {
    id: "unlabel",
    prefix: "unlabel ",
    group: "Actions",
    icon: IconTagOff,
    mode: "async",
    hint: (remainder) => `This track's labels matching “${remainder}”…`,
    description: "Remove a label from this track",
    emptyLabel: (remainder) =>
      `This track has no label matching “${remainder}”`,
    isAvailable: (ctx) => ctx.route.kind === "track",
    resolve: (remainder, ctx) => resolveUnlabelCandidates(remainder, ctx),
    run: (row, ctx) => runRemoveLabel(row, ctx),
  },
];

/**
 * Prefix commands whose word could still be what the user is typing —
 * `"pla"` matches `play `, not the other way round. Surfaced alongside plain
 * search results so a command's syntax is discoverable without already
 * knowing it: picking one fills the input with the full prefix rather than
 * running anything, so the user can keep typing the argument.
 */
export function matchPrefixCommandCandidates(
  commands: PrefixCommand[],
  query: string
): PrefixCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];
  return commands.filter((command) =>
    command.prefix.toLowerCase().startsWith(trimmed)
  );
}

export { matchPrefixCommand } from "@/components/command-palette/prefix-match";
