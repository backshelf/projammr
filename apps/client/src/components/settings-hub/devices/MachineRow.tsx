"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { removeMachine } from "@/lib/machine-mutations";
import { machineAnchor } from "@/lib/settings/href";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { Machine } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Row, RowMain } from "@workspace/ui/components/layout/rows";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useId } from "react";
import { RejectionList } from "./RejectionList";
import { useMachineMutation } from "./use-machine-mutation";

/**
 * One of the caller's machines: its name, a facts line (platform, dit
 * version, online or when it was last seen), the set open on it, the folders
 * dit leaves alone there, the repos it has pushed (each a link to its page),
 * and Remove, which signs it out of dit after a confirm. The row is the
 * target of `#machine-<id>`: the hub scrolls to it and focuses it.
 */
export function MachineRow({ machine }: { machine: Machine }) {
  const titleId = useId();
  const pushedId = useId();
  const format = useFormat();
  const run = useMachineMutation();
  const removal = useDeleteGate("machine", async () => {
    await run(removeMachine(machine.id), `${machine.name} removed`);
  });

  return (
    <Row
      as="li"
      id={machineAnchor(machine.id)}
      data-machine-row=""
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        "scroll-mt-24 flex-wrap items-start gap-x-8 gap-y-2 py-4",
        "motion-settle hover:bg-transparent",
        "data-target:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
      )}
    >
      <RowMain className="flex min-w-[min(100%,16rem)] flex-col gap-2">
        <h3 id={titleId} className="text-body text-ink">
          {machine.name}
        </h3>
        <p
          className={cn(
            LABEL,
            "flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-faint"
          )}
        >
          <span>{machine.platform}</span>
          <span>dit {machine.appVersion}</span>
          {machine.online ? (
            <span className="text-ink">online</span>
          ) : (
            <span>Last seen {format.relative(machine.lastSeenAt)}</span>
          )}
        </p>
        {machine.openSession && (
          <p className="text-small text-ink-soft">
            Open:{" "}
            <AppLink
              href={hrefFromParsedRoute(
                { kind: "session", sessionId: machine.openSession.id },
                machine.openSession.projectId
              )}
              className="text-ink underline-offset-4 hover:underline focus-visible:underline"
            >
              {machine.openSession.name}
            </AppLink>
          </p>
        )}
        {machine.neverHere.length > 0 && (
          <RejectionList
            heading="Never here"
            items={machine.neverHere.map(({ id, folder }) => ({
              id,
              label: folder,
            }))}
          />
        )}
        {machine.pushedRepos.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 id={pushedId} className={cn(LABEL, "text-ink-faint")}>
              Pushed
            </h4>
            <ul
              aria-labelledby={pushedId}
              className="flex flex-wrap gap-x-4 gap-y-1"
            >
              {machine.pushedRepos.map((repo) => (
                <li key={repo.id}>
                  <AppLink
                    href={hrefFromParsedRoute(
                      { kind: "repo", repoId: repo.id },
                      repo.projectId
                    )}
                    className="text-small text-ink underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {repo.name}
                  </AppLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </RowMain>
      <Button
        variant="ghost"
        size="sm"
        className="text-ink-soft hover:text-danger"
        aria-label={`Remove ${machine.name}`}
        onClick={() => removal.request()}
      >
        Remove
      </Button>
      <ConfirmDeleteDialog
        {...removal.dialog}
        title={`Remove ${machine.name}?`}
        description="It's signed out of dit; its saves and commits stay."
        confirmLabel="Remove"
      />
    </Row>
  );
}
