import { AppLink } from "@/components/navigation/AppLink";
import {
  lastPushParts,
  ownMachineHref,
  type PushMachine,
} from "@/lib/repo-copy";
import type { Repo } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The name of the machine a repo was last pushed from: a link to its row on
 * the Devices page when it is the viewer's own, plain text when it is anyone
 * else's.
 */
export function MachineLink({
  machine,
  viewerId,
}: {
  machine: PushMachine;
  viewerId: string | null;
}) {
  const href = ownMachineHref(machine, viewerId);
  if (href === null) return machine.name;
  return (
    <AppLink
      href={href}
      className="text-ink underline-offset-4 hover:underline focus-visible:underline"
    >
      {machine.name}
    </AppLink>
  );
}

/** "Last push 2h ago from <machine>" for a repo page's lede, the machine linked when it is the viewer's. */
export function LastPushLine({
  repo,
  format,
  viewerId,
}: {
  repo: Pick<Repo, "lastPushAt" | "lastPushMachine">;
  format: Pick<Formatters, "relative">;
  viewerId: string | null;
}) {
  const { when, machine } = lastPushParts(repo, format);
  if (!machine) return when;
  return (
    <>
      {when} from <MachineLink machine={machine} viewerId={viewerId} />
    </>
  );
}
