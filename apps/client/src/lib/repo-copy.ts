import { machineHref } from "@/lib/settings/href";
import type { Repo } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";

/** The machine a repo was last pushed from. */
export type PushMachine = NonNullable<Repo["lastPushMachine"]>;

/**
 * The part of the last-push line before the machine: "Last push 2h ago", or
 * what a repo nothing reached says.
 */
export function lastPushWhen(
  repo: Pick<Repo, "lastPushAt">,
  format: Pick<Formatters, "relative">
): string {
  if (repo.lastPushAt == null) return "Nothing pushed yet.";
  return `Last push ${format.relative(repo.lastPushAt)}`;
}

/**
 * The last-push line in its two parts: the `when` sentence, and the machine
 * that follows it ("from <machine>") when the push named one.
 */
export function lastPushParts(
  repo: Pick<Repo, "lastPushAt" | "lastPushMachine">,
  format: Pick<Formatters, "relative">
): { when: string; machine: PushMachine | null } {
  return {
    when: lastPushWhen(repo, format),
    machine: repo.lastPushAt != null ? repo.lastPushMachine : null,
  };
}

/** "Last push 2h ago from studio-mac", or what a repo nothing reached says. */
export function lastPushLine(
  repo: Pick<Repo, "lastPushAt" | "lastPushMachine">,
  format: Pick<Formatters, "relative">
): string {
  const { when, machine } = lastPushParts(repo, format);
  return machine ? `${when} from ${machine.name}` : when;
}

/**
 * Where a machine's row is on the Devices page, only when the machine is the
 * viewer's own and still there: another account's machine has no row they can
 * open, and a removed one has none at all, so both stay plain text (`null`).
 */
export function ownMachineHref(
  machine: Pick<PushMachine, "id" | "userId" | "removed">,
  viewerId: string | null
): string | null {
  return viewerId !== null && machine.userId === viewerId && !machine.removed
    ? machineHref(machine.id)
    : null;
}

/**
 * The repo's storage as one line: what its sets and its samples hold, and what
 * sharing saved when it saved anything ("<size> saved by sharing"). A repo
 * holding nothing yet reads as sets alone at zero.
 */
export function storageLine(
  storage: Repo["storage"],
  format: Pick<Formatters, "bytes">
): string {
  const parts = [
    `Sets ${format.bytes(storage.setBytes, 1)}`,
    `Samples ${format.bytes(storage.sampleBytes, 1)}`,
  ];
  if (storage.sharedBytes > 0) {
    parts.push(`${format.bytes(storage.sharedBytes, 1)} saved by sharing`);
  }
  return parts.join(" · ");
}
