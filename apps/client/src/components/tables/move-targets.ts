/**
 * Where a row can be moved: every project the user belongs to except the one
 * it is already in, in the order a picker should list them. Edit access in the
 * destination is the server's call — it refuses a move the caller may not
 * make — so a project the user can only read is still offered here.
 */
export function movableTargets<T extends { id: number; name: string }>(
  projects: T[],
  currentProjectId: number
): T[] {
  return projects
    .filter((project) => project.id !== currentProjectId)
    .sort((a, b) => a.name.localeCompare(b.name));
}
