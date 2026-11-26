import type { EffectiveSettings } from "@/lib/settings/effective";
import { labFrom } from "@/lib/policies/from-settings";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";

/**
 * Where a project's normalise target comes from: `projectId`'s effective
 * settings, or an `ActionError` when they could not be read.
 */
export type ReadProjectSettings = (
  projectId: number
) => Promise<EffectiveSettings | ActionError>;

/** The Lab's normalise target for a project, or null where it could not be read. */
export type ProjectTargetResolver = (
  projectId: number
) => Promise<number | null>;

/**
 * Resolves the normalise target a project's members play at, reading each
 * project's effective settings once per resolver. A read that fails answers
 * null and is forgotten, so the next track from that project asks again.
 */
export function createProjectTargetResolver(
  read: ReadProjectSettings
): ProjectTargetResolver {
  const targets = new Map<number, Promise<number | null>>();

  return (projectId) => {
    const known = targets.get(projectId);
    if (known) return known;

    const target = read(projectId).then(
      (result) =>
        isActionError(result)
          ? null
          : labFrom(result.values).normaliseTargetLufs,
      () => null
    );
    targets.set(projectId, target);
    void target.then((lufs) => {
      if (lufs === null && targets.get(projectId) === target) {
        targets.delete(projectId);
      }
    });
    return target;
  };
}
