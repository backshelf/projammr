import {
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { IconCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Progress } from "@workspace/ui/components/progress";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import { useFocusTarget } from "../focus-target";
import type { PendingRestore, RestoreState } from "../ipc";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { isRestoring } from "../screen";
import { describeFailure, useCommand } from "../use-command";
import { fileName } from "../renders/render-model";

/**
 * A `projammr://dit/checkout/<commit id>` link arrived: the commit's message and set, the branch name field the app
 * validates, "Restore and open" and "Cancel". The restore's own states come from the app as snapshots, so this screen
 * only shows them: fetching, writing (which cannot be stopped), opened in Live, or failed with the app's reason, which
 * leaves the form in place for another try. The link is let go with `cancel_restore`, whichever button says so.
 */
export function Restore({
  pending,
  restore,
  liveOpen,
}: {
  pending: PendingRestore;
  restore: RestoreState;
  /** The path of the set Live has open, null when none is. */
  liveOpen: string | null;
}): JSX.Element {
  const title =
    pending.problem !== null
      ? "Can't restore this commit"
      : "Restore as a new branch";
  const lede = pending.set === null ? undefined : `In ${pending.set}.`;
  const lookingUp = pending.problem === null && pending.message === null;

  return (
    <div className="flex flex-col gap-4">
      <PanelHead title={title} lede={lede} blocking />
      {pending.problem !== null ? (
        <Closed line={pending.problem} label="Close" />
      ) : (
        <>
          {lookingUp ? (
            <div className="flex flex-col gap-1.5">
              <Progress
                value={30}
                aria-label="Looking up commit"
                indicatorClassName="bg-art"
              />
              <p role="status" className="text-small text-ink-soft">
                {"Looking up commit\u2026"}
              </p>
            </div>
          ) : (
            <blockquote className="border-l-2 border-rule-strong pl-3 text-small text-pretty text-ink">
              {pending.message}
            </blockquote>
          )}
          {restore.state === "opened" ? (
            <Opened file={restore.file} note={restore.note} />
          ) : isRestoring(restore) ? (
            <Running restore={restore} />
          ) : (
            <BranchForm
              pending={pending}
              failed={restore.state === "failed" ? restore : null}
              liveOpen={liveOpen}
            />
          )}
        </>
      )}
    </div>
  );
}

function leave(): Promise<void> {
  return call("cancel_restore");
}

/** A link the app can do nothing with: its reason and the way out. */
function Closed({ line, label }: { line: string; label: string }): JSX.Element {
  const { run, pending, error } = useCommand();
  return (
    <>
      <p role="alert" className="text-small text-pretty text-danger">
        {line}
      </p>
      <ErrorLine error={error} />
      <Button
        size="lg"
        variant="outline"
        disabled={pending}
        onClick={() => void run(leave)}
        className="self-start"
      >
        {label}
      </Button>
    </>
  );
}

type Failed = Extract<RestoreState, { state: "failed" }>;

function BranchForm({
  pending: restoring,
  failed,
  liveOpen,
}: {
  pending: PendingRestore;
  /** Why the last try failed, kept above the buttons while the name is edited. */
  failed: Failed | null;
  /** The set Live has open, whose file a restore never writes to. */
  liveOpen: string | null;
}): JSX.Element {
  const nameId = useId();
  const refusalId = useId();
  const focusTarget = useFocusTarget();
  const [edited, setEdited] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const askedRef = useRef(0);
  const { run, pending, error } = useCommand();
  const name = edited ?? restoring.branch ?? "";
  const suggestion = failed?.suggestion ?? null;
  const inUse = failed?.existing ?? null;
  const liveHasIt = inUse !== null && inUse === liveOpen;

  // The app owns the rules for a branch name: each edit is asked of it, and the latest answer wins.
  function edit(value: string): void {
    setEdited(value);
    const ask = ++askedRef.current;
    call("validate_branch_name", { name: value }).then(
      () => {
        if (ask === askedRef.current) setRefusal(null);
      },
      (reason: unknown) => {
        if (ask === askedRef.current) setRefusal(describeFailure(reason));
      }
    );
  }
  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void run(() =>
      call("restore", { commitId: restoring.commitId, name: name.trim() })
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={nameId}>Branch name</FieldLabel>
        <PanelInput
          id={nameId}
          value={name}
          onChange={(event) => edit(event.target.value)}
          ref={focusTarget}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={refusal !== null || undefined}
          aria-describedby={refusal === null ? undefined : refusalId}
        />
      </Field>
      <ErrorLine error={refusal} id={refusalId} />
      {failed !== null && (
        <div className="flex flex-col gap-2">
          {inUse !== null && liveHasIt ? (
            // The file never frees up while Live holds it, so the restore does not wait: it names the file and
            // offers the other name.
            <ErrorLine
              error={`Live has ${fileName(inUse)} open. Restore under another name.`}
            />
          ) : (
            <ErrorLine error={failed.message} />
          )}
          {suggestion !== null && name !== suggestion && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => edit(suggestion)}
            >
              Use {suggestion}
            </Button>
          )}
        </div>
      )}
      <ErrorLine error={error} />
      <p className="text-small text-pretty text-ink-soft">
        The restore writes a new file beside the set. The set Live has open is
        never changed.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="lg"
          disabled={
            pending ||
            refusal !== null ||
            name.trim() === "" ||
            restoring.message === null
          }
        >
          Restore and open
        </Button>
        <CancelButton disabled={pending} label="Cancel" />
      </div>
    </form>
  );
}

function CancelButton({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}): JSX.Element {
  const { run, pending, error } = useCommand();
  return (
    <>
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => void run(leave)}
        className="self-start"
      >
        {label}
      </Button>
      <ErrorLine error={error} />
    </>
  );
}

/** Fetching and writing: what the app is doing, and the honest answer about closing the screen. */
function Running({
  restore,
}: {
  restore: Extract<RestoreState, { state: "fetching" | "writing" }>;
}): JSX.Element {
  const line =
    restore.state === "fetching"
      ? restore.objects > 0
        ? `Fetching the commit\u2026 ${restore.objects} ${restore.objects === 1 ? "object" : "objects"}`
        : "Fetching the commit\u2026"
      : `Writing ${restore.file}\u2026`;

  const percent =
    restore.state === "writing"
      ? 85
      : Math.min(80, Math.max(15, restore.objects * 10));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Progress
          value={percent}
          aria-label="Restore progress"
          aria-valuenow={percent}
          indicatorClassName="bg-art"
        />
        <p
          role="status"
          className="text-small [overflow-wrap:anywhere] text-ink"
        >
          {line}
        </p>
      </div>
      <p className="text-small text-pretty text-ink-soft">
        A restore can't be stopped once it has started. Closing this keeps it
        going; the file is still written, it just isn't opened.
      </p>
      <CancelButton disabled={false} label="Close" />
    </>
  );
}

function Opened({
  file,
  note,
}: {
  file: string;
  note: string | null;
}): JSX.Element {
  const { run, pending, error } = useCommand();
  const body: ReactNode =
    note === null ? (
      <>
        Opened in Live
        <span className="block [overflow-wrap:anywhere] text-ink-soft">
          {file}
        </span>
      </>
    ) : (
      <>
        Restored {file}
        <span className="block text-ink-soft">{note}</span>
      </>
    );
  return (
    <>
      <p
        role="status"
        className="flex items-start gap-2 text-small [overflow-wrap:anywhere] text-ink"
      >
        <IconCheck aria-hidden className="mt-px size-3.5 shrink-0 text-art" />
        <span>{body}</span>
      </p>
      <ErrorLine error={error} />
      <Button
        size="lg"
        variant="outline"
        disabled={pending}
        onClick={() => void run(leave)}
        className="self-start"
      >
        Done
      </Button>
    </>
  );
}
