import type { SavedViewKind } from "@workspace/api/api";

/**
 * `tables.defaultSavedView`'s value: which saved view each table kind opens
 * on by default, per project. Keyed by the project id stringified, since a
 * settings value travels through JSON.
 */
export type DefaultSavedViewMap = Record<
  string,
  Partial<Record<SavedViewKind, number>>
>;

/** The saved view id `(projectId, kind)` currently defaults to, if any. */
export function defaultSavedViewId(
  map: DefaultSavedViewMap,
  projectId: number,
  kind: SavedViewKind
): number | undefined {
  return map[String(projectId)]?.[kind];
}

/**
 * `map` with `[projectId][kind]` set to `viewId`, every other project's and
 * kind's entry unchanged.
 */
export function setDefaultSavedView(
  map: DefaultSavedViewMap,
  projectId: number,
  kind: SavedViewKind,
  viewId: number
): DefaultSavedViewMap {
  const key = String(projectId);
  return { ...map, [key]: { ...map[key], [kind]: viewId } };
}

/**
 * `map` with `[projectId][kind]` removed, every other project's and kind's
 * entry unchanged. Drops the project's entry entirely once it has no kind
 * left, so a cleared map does not accumulate empty entries. A no-op (same
 * reference back) when there is nothing to clear.
 */
export function clearDefaultSavedView(
  map: DefaultSavedViewMap,
  projectId: number,
  kind: SavedViewKind
): DefaultSavedViewMap {
  const key = String(projectId);
  const entry = map[key];
  if (!entry || !(kind in entry)) return map;

  const rest = { ...entry };
  delete rest[kind];
  const next = { ...map, [key]: rest };
  if (Object.keys(rest).length === 0) delete next[key];
  return next;
}
