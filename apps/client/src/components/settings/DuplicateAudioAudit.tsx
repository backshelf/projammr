"use client";

import { useMutate } from "@/hooks/use-mutate";
import { useProjectRole } from "@/hooks/use-project-role";
import { removeDuplicateAudio } from "@/lib/asset-mutations";
import { getDuplicateAudio } from "@/lib/asset-queries";
import type { DuplicateAudioGroup } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Spinner } from "@workspace/ui/components/spinner";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useState, type MouseEvent } from "react";
import { toast } from "sonner";

/** The most ids one removal request takes. */
const BATCH_SIZE = 500;

const SKIP_REASONS: Record<
  NonNullable<DuplicateAudioGroup["skipped"][number]["reason"]>,
  string
> = {
  "in-use": "Used where the kept file isn't",
  commented: "Has comments",
  shared: "Pinned in a snapshot share",
};

type Audit =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; groups: DuplicateAudioGroup[] };

function FileRow({
  name,
  size,
  note,
  detail,
}: {
  name: string;
  size: number;
  note: string;
  detail?: string;
}) {
  const format = useFormat();

  return (
    <li className="flex items-baseline gap-3 text-small">
      <span className="w-20 shrink-0 text-micro tracking-wider text-ink-soft uppercase">
        {note}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={name}>
          {name}
        </span>
        {detail && (
          <span className="block text-micro text-ink-soft">{detail}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-micro text-ink-soft tabular-nums">
        {format.bytes(size)}
      </span>
    </li>
  );
}

function GroupList({ groups }: { groups: DuplicateAudioGroup[] }) {
  return (
    <ul className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
      {groups.map((group) => (
        <li key={group.kept.id}>
          <ul className="space-y-1.5 border-t border-rule pt-3">
            <FileRow {...group.kept} note="Keeps" />
            {group.remove.map((file) => (
              <FileRow key={file.id} {...file} note="Removes" />
            ))}
            {group.skipped.map((file) => (
              <FileRow
                key={file.id}
                {...file}
                note="Skipped"
                detail={SKIP_REASONS[file.reason]}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * The project's duplicate-audio audit: a button that reads what the server
 * would remove and shows it in a dialog. Nothing is deleted until the user
 * confirms, and then only the files listed under "Removes". Editors and above.
 */
export function DuplicateAudioAudit({ projectId }: { projectId: number }) {
  const canEdit = useProjectRole()?.can("editor") ?? false;
  const mutate = useMutate();
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<Audit>({ status: "loading" });
  const [removing, setRemoving] = useState(false);

  if (!canEdit) return null;

  const load = async () => {
    setAudit({ status: "loading" });
    const result = await getDuplicateAudio(projectId);
    setAudit(
      isActionError(result)
        ? { status: "error", message: result.error }
        : { status: "ready", groups: result.groups }
    );
  };

  const ids =
    audit.status === "ready"
      ? audit.groups.flatMap((group) => group.remove.map((file) => file.id))
      : [];

  const remove = async (event: MouseEvent) => {
    event.preventDefault();
    setRemoving(true);
    let deleted = 0;
    try {
      for (let start = 0; start < ids.length; start += BATCH_SIZE) {
        const result = await mutate(
          removeDuplicateAudio(projectId, ids.slice(start, start + BATCH_SIZE))
        );
        if (isActionError(result)) {
          toast.error(
            deleted > 0
              ? `Removed ${pluralizeCount(deleted, "file")}, then failed: ${result.error}`
              : result.error
          );
          return;
        }
        deleted += result.deleted;
      }
      toast.success(`Removed ${pluralizeCount(deleted, "duplicate file")}`);
      setOpen(false);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Find duplicates
      </Button>
      <AlertDialog open={open} onOpenChange={removing ? undefined : setOpen}>
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate audio</AlertDialogTitle>
            <AlertDialogDescription>
              Bounces uploaded in more than one format keep their largest file.
              Nothing is deleted until you confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {audit.status === "loading" && (
            <div className="flex items-center gap-2 text-small text-ink-soft">
              <Spinner /> Looking for duplicates…
            </div>
          )}
          {audit.status === "error" && (
            <div role="alert" className="space-y-2">
              <p className="text-small text-danger">{audit.message}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}
          {audit.status === "ready" && ids.length === 0 && (
            <p className="text-small">No duplicate audio found.</p>
          )}
          {audit.status === "ready" && audit.groups.length > 0 && (
            <GroupList groups={audit.groups} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Close</AlertDialogCancel>
            {ids.length > 0 && (
              <AlertDialogAction
                variant="destructive"
                disabled={removing}
                onClick={remove}
              >
                Remove {pluralizeCount(ids.length, "file")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
