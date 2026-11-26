import type { SessionSave } from "@workspace/api/api";

/**
 * The newest recorded save older than a session's current file: the save the
 * current one followed. The newest recorded save is normally the current
 * file's own, so it is passed over by time rather than by position, which
 * also holds when the current file's save was never recorded. `saves` is
 * newest first; `fileUpdatedAt` is null for a session with no file, which
 * has no saves before it.
 */
export function saveBefore(
  saves: readonly SessionSave[],
  fileUpdatedAt: string | null
): SessionSave | undefined {
  if (fileUpdatedAt == null) return undefined;
  const current = Date.parse(fileUpdatedAt);
  return saves.find((save) => Date.parse(save.fileUpdatedAt) < current);
}
