import {
  AudioClip,
  Track,
  initialize,
  type ActivationContext,
  type ArrangementSelection,
  type ContextMenuScope,
  type ExtensionContext,
  type Song,
} from "@ableton-extensions/sdk";
import * as path from "node:path";

import {
  buildCommitDialog,
  type CommitDialogResult,
} from "./dialogs/commit.js";
import { buildNoteDialog, type NoteDialogResult } from "./dialogs/note.js";
import { dialogUrl } from "./dialogs/shared.js";
import {
  buildSyncCommentsDialog,
  type SyncCommentCandidate,
  type SyncCommentsDialogResult,
} from "./dialogs/sync-comments.js";
import { DitIpcClient } from "./dit-ipc.js";
import { discoverActiveRepo, type RepoContext } from "./live-set.js";
import {
  ProjammrClient,
  resolveToken,
  type CommentTarget,
} from "./projammr-api.js";
import {
  formatBarsBeats,
  formatCueLabel,
  formatSelectionSummary,
  formatTimecode,
  hasMatchingCue,
  msToBeats,
} from "./time.js";

const CMD_COMMIT = "projammr.commitOrOpenDit";
const CMD_NOTE = "projammr.addNoteOrCuePoint";
const CMD_SYNC_COMMENTS = "projammr.syncCommentsToCuePoints";

const SET_ACTION_SCOPES: readonly ContextMenuScope<"1.0.0">[] = [
  "AudioTrack",
  "MidiTrack",
  "Scene",
  "AudioClip",
  "MidiClip",
  "ClipSlot",
];

const SYNC_SCOPES: readonly ContextMenuScope<"1.0.0">[] = [
  "AudioTrack",
  "MidiTrack",
  "Scene",
];

const SELECTION_SCOPES: readonly ContextMenuScope<"1.0.0">[] = [
  "AudioTrack.ArrangementSelection",
  "MidiTrack.ArrangementSelection",
];

function collectSamplePaths(song: Song<"1.0.0">): string[] {
  const paths: string[] = [];
  for (const track of song.tracks) {
    for (const clip of track.arrangementClips) {
      if (clip instanceof AudioClip && clip.filePath) {
        paths.push(clip.filePath);
      }
    }
    for (const slot of track.clipSlots) {
      if (slot.clip instanceof AudioClip && slot.clip.filePath) {
        paths.push(slot.clip.filePath);
      }
    }
  }
  return paths;
}

function setNameOf(repo: RepoContext | null): string {
  if (!repo) return "Untitled Set";
  if (repo.setFile) return path.basename(repo.setFile, ".als");
  return path.basename(repo.projectRoot).replace(/ Project$/i, "");
}

function parseDialogResult<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function resolveProjammrBinding(
  repo: RepoContext | null,
  storageDirectory: string | undefined
): Promise<
  | { ok: true; client: ProjammrClient; target: CommentTarget }
  | { ok: false; reason: string }
> {
  if (!repo) {
    return {
      ok: false,
      reason: "Save this Live Set first so dit can find it.",
    };
  }
  if (!repo.hasDit) {
    return { ok: false, reason: "This project folder is not tracked by dit." };
  }
  const instance = process.env.PROJAMMR_INSTANCE?.trim() || repo.instance;
  if (!instance) {
    return { ok: false, reason: "No Projammr instance configured in dit." };
  }
  if (repo.sessionId === null) {
    return {
      ok: false,
      reason: "This set hasn\u2019t been pushed to Projammr yet.",
    };
  }
  const token = resolveToken(instance, { storageDirectory });
  if (!token) {
    return {
      ok: false,
      reason:
        "Not signed in to Projammr (run `dit login` or set PROJAMMR_TOKEN).",
    };
  }
  const client = new ProjammrClient(instance, token);
  const target = await client.resolveCommentTarget(repo.sessionId);
  return { ok: true, client, target };
}

async function handleCommitCommand(
  context: ExtensionContext<"1.0.0">,
  dit: DitIpcClient
): Promise<void> {
  const song = context.application.song;
  const repo = discoverActiveRepo(collectSamplePaths(song));
  const ditRunning = await dit.ping();

  let setName = setNameOf(repo);
  let branch = "main";
  let savesSinceCommit = 0;
  let workingChanged = false;
  let firstCommit = false;
  let suggestedMessage = "";
  let error: string | null = null;

  if (!ditRunning) {
    error =
      "The dit menu bar app isn\u2019t running. Launch dit to commit from Live.";
  } else if (!repo) {
    error = "Could not locate a saved Live Set on disk. Save the set first.";
  } else if (!repo.hasDit) {
    error = `Project folder "${path.basename(repo.projectRoot)}" isn\u2019t tracked by dit yet.`;
  } else {
    try {
      const status = await dit.status(
        repo.projectRoot,
        repo.setFile ?? undefined
      );
      const row =
        status.sets.find((s) => s.file === repo.setFile) ?? status.sets[0];
      if (row) {
        setName = path.basename(row.file, ".als");
        branch = row.branch;
        savesSinceCommit = row.savesSinceCommit;
        workingChanged = row.workingChanged;
        if (row.workingChanged) {
          const suggestion = await dit.suggestedCommit(
            repo.projectRoot,
            row.file
          );
          suggestedMessage = suggestion.message ?? "";
          firstCommit = suggestion.firstCommit;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const canCommit = ditRunning && !error && workingChanged;
  const html = buildCommitDialog({
    setName,
    branch,
    savesSinceCommit,
    workingChanged,
    firstCommit,
    suggestedMessage,
    error,
    ditRunning,
  });

  const url = dialogUrl(html, context.environment.tempDirectory, "commit");
  const raw = await context.ui.showModalDialog(url, 420, canCommit ? 300 : 195);
  const result = parseDialogResult<CommitDialogResult>(raw);
  if (!result || result.action === "cancel") return;

  if (result.action === "open-panel") {
    await dit.showPanel();
    return;
  }

  if (result.action === "commit" && repo) {
    await context.ui.withinProgressDialog(
      "Committing in dit…",
      { progress: 25 },
      async (update) => {
        const committed = await dit.commit(repo.projectRoot, {
          message: result.message,
          noPush: result.noPush,
          ...(repo.setFile ? { setFile: repo.setFile } : {}),
          onStderr: (line) => {
            const trimmed = line.trim();
            if (trimmed) void update(trimmed);
          },
        });
        await update(`Committed: ${committed.message}`, 100);
        console.log(
          `[projammr] committed ${committed.id}: ${committed.message}`
        );
      }
    );
  }
}

async function handleNoteCommand(
  context: ExtensionContext<"1.0.0">,
  selection: ArrangementSelection
): Promise<void> {
  const song = context.application.song;
  const tempo = song.tempo;
  const trackNames = selection.selected_lanes.map((handle) => {
    try {
      return context.getObjectFromHandle(handle, Track).name;
    } catch {
      return "Track";
    }
  });
  const summary = formatSelectionSummary(
    selection.time_selection_start,
    selection.time_selection_end,
    tempo
  );
  const repo = discoverActiveRepo(collectSamplePaths(song));

  let binding: Awaited<ReturnType<typeof resolveProjammrBinding>>;
  try {
    binding = await resolveProjammrBinding(
      repo,
      context.environment.storageDirectory
    );
  } catch (err) {
    binding = {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const html = buildNoteDialog({
    setName: setNameOf(repo),
    trackNames,
    barRange: summary.barRange,
    timeRange: summary.timeRange,
    positionMs: summary.positionMs,
    canPostToProjammr: binding.ok,
    projammrTargetLabel: binding.ok ? binding.target.label : null,
    projammrReason: binding.ok ? null : binding.reason,
  });

  const url = dialogUrl(html, context.environment.tempDirectory, "note");
  const raw = await context.ui.showModalDialog(url, 440, 320);
  const result = parseDialogResult<NoteDialogResult>(raw);
  if (!result || result.action !== "submit") return;

  const trackPrefix =
    trackNames.length > 0 ? `[${trackNames.join(", ")}] ` : "";

  if (result.addCuePoint) {
    const label = formatCueLabel(`${trackPrefix}${result.content}`);
    await context.withinTransaction(() =>
      song.createCuePoint(selection.time_selection_start).then((cue) => {
        cue.name = label;
        return cue;
      })
    );
  }

  if (result.postToProjammr && binding.ok) {
    const commentBody = `${trackPrefix}(${summary.barRange}) ${result.content}`;
    await context.ui.withinProgressDialog(
      "Posting comment to Projammr…",
      { progress: 50 },
      async (update) => {
        await binding.client.createComment({
          targetType: binding.target.targetType,
          targetId: binding.target.targetId,
          content: commentBody,
          positionMs:
            binding.target.targetType === "track_audio"
              ? summary.positionMs
              : null,
        });
        await update("Posted to Projammr", 100);
      }
    );
  }
}

async function handleSyncCommentsCommand(
  context: ExtensionContext<"1.0.0">
): Promise<void> {
  const song = context.application.song;
  const tempo = song.tempo;
  const repo = discoverActiveRepo(collectSamplePaths(song));

  let targetLabel: string | null = null;
  let items: SyncCommentCandidate[] = [];
  let error: string | null = null;

  try {
    const binding = await resolveProjammrBinding(
      repo,
      context.environment.storageDirectory
    );
    if (!binding.ok) {
      error = binding.reason;
    } else {
      targetLabel = binding.target.label;
      const comments = await binding.client.getComments(
        binding.target.targetType,
        binding.target.targetId
      );
      const existingCues = song.cuePoints.map((cue) => ({
        time: cue.time,
        name: cue.name,
      }));
      items = comments
        .filter(
          (comment): comment is typeof comment & { positionMs: number } =>
            typeof comment.positionMs === "number" &&
            comment.resolvedAt === null
        )
        .map((comment) => {
          const beat = msToBeats(comment.positionMs, tempo);
          const author = comment.user?.name ?? comment.user?.email ?? null;
          const label = formatCueLabel(comment.content, author);
          return {
            id: comment.id,
            label,
            beat,
            barLabel: formatBarsBeats(beat),
            timecode: formatTimecode(comment.positionMs),
            alreadyExists: hasMatchingCue(existingCues, beat, label),
          };
        });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const html = buildSyncCommentsDialog({
    setName: setNameOf(repo),
    targetLabel,
    tempo,
    items,
    error,
  });

  const height = error || items.length === 0 ? 200 : 370;
  const url = dialogUrl(
    html,
    context.environment.tempDirectory,
    "sync-comments"
  );
  const raw = await context.ui.showModalDialog(url, 450, height);
  const result = parseDialogResult<SyncCommentsDialogResult>(raw);
  if (!result || result.action !== "sync" || result.selectedIds.length === 0) {
    return;
  }

  const chosen = new Set(result.selectedIds);
  const toCreate = items.filter(
    (item) => chosen.has(item.id) && !item.alreadyExists
  );
  if (toCreate.length === 0) return;

  await context.withinTransaction(() =>
    Promise.all(
      toCreate.map((item) =>
        song.createCuePoint(item.beat).then((cue) => {
          cue.name = item.label;
          return cue;
        })
      )
    )
  );
  console.log(
    `[projammr] added ${toCreate.length} cue point(s) from Projammr comments`
  );
}

export function activate(activation: ActivationContext): void {
  const context = initialize(activation, "1.0.0");
  const dit = new DitIpcClient();

  context.commands.registerCommand(CMD_COMMIT, () => {
    void handleCommitCommand(context, dit).catch((err) =>
      console.error("[projammr] commit command failed:", err)
    );
  });

  context.commands.registerCommand(CMD_NOTE, (arg: unknown) => {
    void handleNoteCommand(context, arg as ArrangementSelection).catch((err) =>
      console.error("[projammr] note command failed:", err)
    );
  });

  context.commands.registerCommand(CMD_SYNC_COMMENTS, () => {
    void handleSyncCommentsCommand(context).catch((err) =>
      console.error("[projammr] sync comments command failed:", err)
    );
  });

  for (const scope of SET_ACTION_SCOPES) {
    void context.ui.registerContextMenuAction(
      scope,
      "Projammr: Commit / Open dit…",
      CMD_COMMIT
    );
  }

  for (const scope of SYNC_SCOPES) {
    void context.ui.registerContextMenuAction(
      scope,
      "Projammr: Sync Comments to Cue Points…",
      CMD_SYNC_COMMENTS
    );
  }

  for (const scope of SELECTION_SCOPES) {
    void context.ui.registerContextMenuAction(
      scope,
      "Projammr: Add Note / Cue Point…",
      CMD_NOTE
    );
  }
}
