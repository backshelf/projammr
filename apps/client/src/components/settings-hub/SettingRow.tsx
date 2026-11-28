"use client";

import type { SettingsWriteScope } from "@/lib/settings/provider";
import { IconLock } from "@tabler/icons-react";
import { Row, RowMain, RowTitle } from "@workspace/ui/components/layout/rows";
import { HeightReveal } from "@workspace/ui/components/height-reveal";
import {
  AnimatePresence,
  FADE,
  LEAVE,
  m,
  SPRING,
} from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type {
  RegisteredSetting,
  SettingLockScope,
  SettingSource,
} from "@workspace/settings";
import { type ReactNode, useId, useState } from "react";
import { SettingControl } from "./controls";
import { descriptionIdOf, errorIdOf, labelIdOf } from "./controls/types";
import { DrawnCheck } from "./DrawnCheck";
import { LockToggle } from "./LockToggle";
import { useSettingRow, type RowStatus } from "./row-state";
import type { RowView } from "./row-view";

/** How each source reads on a row. */
const SOURCE_WORDS: Record<SettingSource, string> = {
  user: "Yours",
  project: "Project",
  instance: "Instance",
  env: "Environment",
  default: "Default",
};

const LOCK_WORDS: Record<SettingLockScope, string> = {
  project: "Locked by project",
  instance: "Locked by instance",
};

/**
 * One setting at the scope it writes: its label and what it does, a control
 * that saves on change, and a line of facts the server decided — where the
 * value comes from, whether this scope holds its own (with a Reset), the lock
 * that pins it, whether the server runs with it yet, and a brief "Saved" once
 * a change lands. A refused change shows why beneath the row, and the control
 * goes back to the saved value.
 *
 * `anchored` gives the row its key as an id, the target of the hub's
 * `#<key>` links; a section's rows are anchored, search results are not.
 */
export function SettingRow({
  definition,
  scope,
  anchored = false,
  note,
}: {
  definition: RegisteredSetting;
  scope: SettingsWriteScope;
  anchored?: boolean;
  /** A line the hub adds under the row's facts, such as a job's last run. */
  note?: ReactNode;
}) {
  const id = useId();
  const row = useSettingRow(definition, scope);
  // The error line folds away after its message is gone, so it keeps the
  // last one to fold away with.
  const [lastError, setLastError] = useState<string | null>(null);
  if (row?.error != null && row.error !== lastError) setLastError(row.error);
  if (!row) return null;

  const { view, status, error } = row;

  return (
    <Row
      id={anchored ? definition.key : undefined}
      data-setting-row=""
      aria-busy={status === "saving" || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) row.leave();
      }}
      className={cn(
        "scroll-mt-24 flex-wrap items-start gap-x-8 gap-y-2 py-4",
        "motion-settle hover:bg-transparent",
        "data-target:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
      )}
    >
      <RowMain className="flex min-w-[min(100%,16rem)] flex-col gap-1">
        <RowTitle className="whitespace-normal">
          <label id={labelIdOf(id)} htmlFor={id}>
            {definition.label}
          </label>
        </RowTitle>
        <p
          id={descriptionIdOf(id)}
          className="max-w-[54ch] text-small text-pretty text-ink-soft"
        >
          {definition.description}
        </p>
        <RowFacts
          view={view}
          status={status}
          restartRequired={definition.restartRequired === true}
          label={definition.label}
          onReset={row.reset}
        />
        {note}
      </RowMain>
      {/* Capped at the row, so a fixed-width control shrinks on a narrow
          phone instead of pushing the page sideways. */}
      <div className="flex max-w-full min-w-0 shrink-0 items-center gap-3 has-[[data-wide-control]]:w-full has-[[data-wide-control]]:max-w-80">
        <SettingControl
          definition={definition}
          value={row.value}
          onChange={row.change}
          disabled={!view.editable}
          id={id}
          invalid={error !== null}
        />
        {row.locked !== undefined && (
          <LockToggle
            locked={row.locked}
            label={definition.label}
            onChange={row.setLocked}
          />
        )}
      </div>
      <HeightReveal open={error !== null} className="basis-full">
        <p
          id={errorIdOf(id)}
          role="alert"
          className="text-small text-pretty text-danger"
        >
          {error ?? lastError}
        </p>
      </HeightReveal>
    </Row>
  );
}

/** The row's facts, in the label shape: source, Reset, lock, restart, and the save's progress. */
function RowFacts({
  view,
  status,
  restartRequired,
  label,
  onReset,
}: {
  view: RowView;
  status: RowStatus;
  restartRequired: boolean;
  label: string;
  onReset: () => void;
}) {
  const { source, modified, lockedBy, editable, resettable } = view;
  /** This scope's own value is the one in force. */
  const own = modified && !lockedBy;

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div
        className={cn(
          LABEL,
          "flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-faint"
        )}
      >
        <span
          className={cn(
            "inline-flex items-center gap-1.5 motion-ink",
            own && "text-ink"
          )}
        >
          <AnimatePresence initial={false}>
            {own && (
              <m.span
                key="own"
                aria-hidden
                className="size-1.5 rounded-full bg-current"
                initial={{ scale: 0 }}
                animate={{ scale: 1, transition: SPRING.control }}
                exit={{ scale: 0, transition: LEAVE.quick }}
              />
            )}
          </AnimatePresence>
          <span className="sr-only">Value from </span>
          <AnimatePresence initial={false} mode="popLayout">
            <m.span
              key={source}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: FADE.quick }}
              exit={{ opacity: 0, transition: LEAVE.quick }}
            >
              {SOURCE_WORDS[source]}
            </m.span>
          </AnimatePresence>
        </span>
        {resettable && (
          <button
            type="button"
            onClick={onReset}
            aria-label={`Reset ${label}`}
            className={cn(
              "relative cursor-pointer text-ink-soft motion-ink hover:text-ink",
              "rounded-sm focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden",
              "phone:inline-flex phone:min-h-11 phone:items-center coarse:inline-flex coarse:min-h-11 coarse:min-w-11 coarse:items-center coarse:justify-center coarse:px-2 coarse:after:inset-0"
            )}
          >
            Reset
          </button>
        )}
        {lockedBy && (
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <IconLock aria-hidden className="size-3" />
            {LOCK_WORDS[lockedBy]}
          </span>
        )}
        {!editable && !lockedBy && <span>View only</span>}
        {restartRequired && <RestartFact restart={view.restart} />}
        <SaveStatus status={status} />
      </div>
      {lockedBy && modified && (
        <p className="text-micro text-ink-faint">
          The value set here is kept for when it unlocks.
        </p>
      )}
    </div>
  );
}

/**
 * Where a restart-required setting stands against the running server: in
 * force, or set to a value the next restart brings in. Without the server's
 * running value, only that a change waits for a restart.
 */
function RestartFact({ restart }: { restart: RowView["restart"] }) {
  if (restart === "applied") return <span>Applied</span>;
  if (restart === "deployment-off") {
    return <span>Off: this deployment keeps it off</span>;
  }
  if (restart === "pending") {
    return <span className="text-ink motion-ink">Restart to apply</span>;
  }
  return <span>Applies after restart</span>;
}

/** "Saving" while a change travels, then a "Saved" whose tick draws itself; announced either way. */
function SaveStatus({ status }: { status: RowStatus }) {
  return (
    <span role="status" className="inline-flex">
      <AnimatePresence initial={false} mode="popLayout">
        {status === "saving" && (
          <m.span
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: FADE.quick }}
            exit={{ opacity: 0, transition: LEAVE.quick }}
          >
            Saving
          </m.span>
        )}
        {status === "saved" && <SavedMark key="saved" />}
      </AnimatePresence>
    </span>
  );
}

function SavedMark() {
  return (
    <m.span
      className="inline-flex items-center gap-1 text-ink-soft"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FADE.quick }}
      exit={{ opacity: 0, transition: LEAVE.move }}
    >
      <DrawnCheck />
      Saved
    </m.span>
  );
}
