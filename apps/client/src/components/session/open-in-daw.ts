import type { Machine, MachinePresence } from "@workspace/api/api";

/** The machine that can act on a session or a commit: named for the copy, nothing more. */
export type DitHolder = { name: string };

export const OPEN_IN_DAW_UNAVAILABLE =
  "Needs dit on the computer that has this set.";

/**
 * The caller's online machine that tracks the session's repo. Presence lists
 * the machine opening the session first, then the ones that track its repo, so
 * the first tracking machine is the one that holds the set.
 */
export function holderOfSession(
  machines: readonly MachinePresence[]
): DitHolder | null {
  const holder = machines.find((machine) => machine.tracksRepo);
  return holder ? { name: holder.name } : null;
}

/** The caller's online machine tracking a repo, for a session row; none without a repo. */
export function holderOfRepo(
  machines: readonly Machine[],
  repoId: number | null
): DitHolder | null {
  if (repoId == null) return null;
  const holder = machines.find(
    (machine) => machine.online && machine.repoIds.includes(repoId)
  );
  return holder ? { name: holder.name } : null;
}

/** The address an enabled Open in DAW sends; the app finds the set itself. */
export function openInDawHref(sessionId: number): string {
  return `projammr://session/${sessionId}`;
}

/** The address a Restore sends: the hub's integer commit id. */
export function restoreHref(commitId: number): string {
  return `projammr://dit/checkout/${commitId}`;
}

/** Where Open in DAW points and what its tooltip says, given who holds the set. */
export function openInDawTarget(
  sessionId: number,
  holder: DitHolder | null
): { href: string | null; tooltip: string } {
  return holder
    ? {
        href: openInDawHref(sessionId),
        tooltip: `Opens the file on ${holder.name}`,
      }
    : { href: null, tooltip: OPEN_IN_DAW_UNAVAILABLE };
}
