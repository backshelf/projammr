import type { RepoRow } from "./ipc";

/** The repos newest first: by the last save or commit, those with neither last, ties by name. */
export function recentFirst(repos: readonly RepoRow[]): RepoRow[] {
  return repos.toSorted(
    (a, b) =>
      (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) ||
      a.name.localeCompare(b.name)
  );
}

/** The repos whose name or folder holds what was typed, in any case. */
export function matching(repos: readonly RepoRow[], filter: string): RepoRow[] {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return [...repos];
  return repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(needle) ||
      repo.path.toLowerCase().includes(needle)
  );
}
