"use client";

import type {
  SettingsExport,
  SettingsImportReport,
  SettingsImportSkipReason,
} from "@workspace/api/api";
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
import { Spinner } from "@workspace/ui/components/spinner";
import { pluralizeCount } from "@workspace/session-diff/format";
import { MENU_LABEL } from "@workspace/ui/lib/overlay";
import type {
  SettingDefinition,
  SettingKey,
  SettingLockScope,
} from "@workspace/settings";
import { useFormat } from "@workspace/ui/components/format-provider";
import type { MouseEvent, ReactNode } from "react";
import { sameSettingValue, settingLabel, settingOf } from "../format";
import { rowView } from "../row-view";
import type { HubRow } from "../types";
import { ValueChange } from "../ValueChange";

/** How each reason an import skipped a key reads. */
const SKIP_REASONS: Readonly<Record<SettingsImportSkipReason, string>> = {
  unknown: "unknown setting",
  scope: "not a personal setting",
  invalid: "invalid value",
  locked: "locked by instance",
};

/** A key the import would apply, and what it would do to the value this page shows. */
type PreviewChange = {
  key: string;
  label: string;
  /** Absent for a key this page's registry does not know, whose values read raw. */
  definition?: SettingDefinition;
  /** The value the page shows now; absent where the page has no row for the key. */
  from: unknown;
  to: unknown;
  /** A lock holding the key, under which the imported value waits unseen until it lifts. */
  lockedBy?: SettingLockScope;
};

/** A dry run's report, read against the file and the values this page shows. */
export type ImportPreviewModel = {
  /** What the dry run answered. */
  report: SettingsImportReport;
  /** Keys the import would apply, whose value would read differently. */
  changes: PreviewChange[];
  /** Keys the import would apply that already show the file's value. */
  unchanged: PreviewChange[];
};

/**
 * Reads a dry run's report against the file it checked and the page's hub
 * rows: each key it would apply is a change from the value the page shows
 * (the user's own, or what they inherit) to the file's, or already the same.
 */
export function previewOf(
  report: SettingsImportReport,
  file: SettingsExport,
  rowOf: (key: SettingKey) => HubRow | undefined
): ImportPreviewModel {
  const changes: PreviewChange[] = [];
  const unchanged: PreviewChange[] = [];
  for (const key of report.applied) {
    const definition = settingOf(key);
    const row = definition ? rowOf(key as SettingKey) : undefined;
    const from =
      definition && row ? rowView(definition, "user", row).value : undefined;
    const change: PreviewChange = {
      key,
      label: settingLabel(key),
      ...(definition ? { definition } : {}),
      from,
      to: file.values[key],
    };
    if (row?.lockedBy === "project") change.lockedBy = row.lockedBy;
    (row && sameSettingValue(from, change.to) ? unchanged : changes).push(
      change
    );
  }
  return { report, changes, unchanged };
}

/** Where a real import's report parts from its dry run's: keys it skipped after all, and keys it applied after all. */
export type ImportDrift = {
  dropped: SettingsImportReport["skipped"];
  added: string[];
};

/**
 * How the real import differs from the dry run in what it applied (a lock
 * set or lifted in between moves a key across), or `null` where it applied
 * exactly the keys the preview showed.
 */
export function importDrift(
  preview: SettingsImportReport,
  real: SettingsImportReport
): ImportDrift | null {
  const previewed = new Set(preview.applied);
  const dropped = real.skipped.filter(({ key }) => previewed.has(key));
  const added = real.applied.filter((key) => !previewed.has(key));
  return dropped.length === 0 && added.length === 0 ? null : { dropped, added };
}

/** The file the import reads, and what the server made of it. */
type Checked = {
  fileName: string;
  file: SettingsExport;
  preview: ImportPreviewModel;
};

/**
 * Where an import stands. Every phase but `closed` shows the dialog; each
 * failure says what happened and offers the one way on.
 */
export type ImportFlowState =
  | { phase: "closed" }
  /** Reading the file and asking the server for a dry run. */
  | { phase: "checking"; fileName: string }
  /** The file is not one an import takes: another file is the way on. */
  | { phase: "refused"; fileName: string; message: string }
  /** The dry run did not answer: asking again, with the file as read, is the way on. */
  | { phase: "unchecked"; fileName: string; file: unknown; message: string }
  | ({ phase: "preview" } & Checked)
  | ({ phase: "applying" } & Checked)
  /** The import failed; `message` says whether anything could have changed. */
  | ({ phase: "unapplied"; message: string } & Checked)
  /** The import applied a different set of keys than the preview showed. */
  | ({
      phase: "drifted";
      report: SettingsImportReport;
      drift: ImportDrift;
    } & Checked);

/** What the dialog's buttons do. */
export type ImportFlowActions = {
  /** Runs the real import of the previewed file. */
  apply(): void;
  /** Asks for the dry run again. */
  retry(): void;
  /** Opens the file picker for another file. */
  chooseAnother(): void;
  close(): void;
};

/**
 * The import's dialog: the file being checked, the preview of what importing
 * it changes and skips, and what came of it when that was not what the
 * preview said. Nothing changes until Import; while it runs the dialog stays.
 */
export function ImportPreview({
  flow,
  actions,
}: {
  flow: ImportFlowState;
  actions: ImportFlowActions;
}) {
  const busy = flow.phase === "applying";
  return (
    <AlertDialog
      open={flow.phase !== "closed"}
      onOpenChange={busy ? undefined : (open) => !open && actions.close()}
    >
      <AlertDialogContent className="sm:max-w-xl" aria-busy={busy}>
        {flow.phase !== "closed" && <FlowBody flow={flow} actions={actions} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The line under the dialog's title in each phase: what has, and has not, happened yet. */
const LEAD: Record<Exclude<ImportFlowState["phase"], "closed">, string> = {
  checking: "Nothing changes until you import.",
  refused: "Nothing was changed.",
  unchecked: "Nothing was changed.",
  preview: "Nothing changes until you import.",
  applying: "Importing…",
  unapplied: "The import ran into a problem.",
  drifted: "Something changed between the preview and the import.",
};

function FlowBody({
  flow,
  actions,
}: {
  flow: Exclude<ImportFlowState, { phase: "closed" }>;
  actions: ImportFlowActions;
}) {
  const { fileName } = flow;
  const format = useFormat();
  // Only a file the server accepted is known to carry its export date.
  const exported =
    "preview" in flow ? `, exported ${format.date(flow.file.exportedAt)}` : "";

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {flow.phase === "drifted" ? "Settings imported" : "Import settings"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          From <span className="break-all text-ink">{fileName}</span>
          {exported}. {LEAD[flow.phase]}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <PhaseContent flow={flow} />
      <AlertDialogFooter>
        <PhaseButtons flow={flow} actions={actions} />
      </AlertDialogFooter>
    </>
  );
}

function PhaseContent({
  flow,
}: {
  flow: Exclude<ImportFlowState, { phase: "closed" }>;
}) {
  switch (flow.phase) {
    case "checking":
      return (
        <p
          role="status"
          className="flex items-center gap-2 text-small text-ink-soft"
        >
          <Spinner aria-hidden /> Checking what this file would change…
        </p>
      );
    case "refused":
    case "unchecked":
      return <Problem>{flow.message}</Problem>;
    case "preview":
    case "applying":
      return <PreviewLists preview={flow.preview} />;
    case "unapplied":
      return (
        <>
          <PreviewLists preview={flow.preview} />
          <Problem>{flow.message}</Problem>
        </>
      );
    case "drifted":
      return <DriftLists report={flow.report} drift={flow.drift} />;
  }
}

function PhaseButtons({
  flow,
  actions,
}: {
  flow: Exclude<ImportFlowState, { phase: "closed" }>;
  actions: ImportFlowActions;
}) {
  /** Runs `action` and keeps the dialog open: the flow decides when it closes. */
  const stay = (action: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    action();
  };

  switch (flow.phase) {
    case "checking":
      return <AlertDialogCancel>Cancel</AlertDialogCancel>;
    case "refused":
      return (
        <>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={stay(actions.chooseAnother)}>
            Choose another file
          </AlertDialogAction>
        </>
      );
    case "unchecked":
      return (
        <>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={stay(actions.retry)}>
            Try again
          </AlertDialogAction>
        </>
      );
    case "preview":
    case "applying":
    case "unapplied": {
      const applied = flow.preview.report.applied.length;
      const busy = flow.phase === "applying";
      if (applied === 0) {
        return <AlertDialogCancel>Close</AlertDialogCancel>;
      }
      return (
        <>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={stay(actions.apply)}>
            {busy && <Spinner aria-hidden data-icon="inline-start" />}
            {busy
              ? "Importing…"
              : flow.phase === "unapplied"
                ? "Try again"
                : `Import ${pluralizeCount(applied, "setting")}`}
          </AlertDialogAction>
        </>
      );
    }
    case "drifted":
      return <AlertDialogCancel>Done</AlertDialogCancel>;
  }
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-small text-pretty text-danger">
      {children}
    </p>
  );
}

/** A labelled list in the dialog, left out when it has nothing in it. */
function Listing({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h3 className={MENU_LABEL}>
        {label}
        <span className="ml-2 tabular-nums">
          <span className="sr-only">, </span>
          {count}
        </span>
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

const LINE =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-rule py-1.5 text-small";

function PreviewLists({ preview }: { preview: ImportPreviewModel }) {
  const { changes, unchanged, report } = preview;
  const { skipped } = report;

  return (
    <div className="flex max-h-[50dvh] flex-col gap-4 overflow-y-auto pr-1">
      {report.applied.length === 0 && (
        <p className="text-small text-pretty text-ink-soft">
          Nothing in this file can be imported here.
        </p>
      )}
      <Listing label="Changes" count={changes.length}>
        {changes.map((change) => (
          <li key={change.key} className={LINE}>
            <span className="break-all text-ink">{change.label}</span>
            <ValueChange
              definition={change.definition}
              from={change.from}
              to={change.to}
            />
            {change.lockedBy && (
              <span className="basis-full text-micro text-ink-faint">
                Locked by project: yours is kept for when it unlocks.
              </span>
            )}
          </li>
        ))}
      </Listing>
      <Listing label="Already the same" count={unchanged.length}>
        <li className={LINE}>
          <span className="text-ink-soft">
            {unchanged.map(({ label }) => label).join(", ")}
          </span>
        </li>
      </Listing>
      <Listing label="Skipped" count={skipped.length}>
        {skipped.map(({ key, reason }) => (
          <li key={key} className={LINE}>
            <span className="break-all text-ink-soft">{settingLabel(key)}</span>
            <span className="text-ink-faint">{SKIP_REASONS[reason]}</span>
          </li>
        ))}
      </Listing>
    </div>
  );
}

/**
 * What the import did where it differs from the preview: a lock set or lifted
 * between the two moves a key from one list to the other.
 */
function DriftLists({
  report,
  drift: { dropped, added },
}: {
  report: SettingsImportReport;
  drift: ImportDrift;
}) {
  return (
    <div className="flex max-h-[50dvh] flex-col gap-4 overflow-y-auto pr-1">
      <p className="text-small text-pretty text-ink">
        Imported {pluralizeCount(report.applied.length, "setting")}.
      </p>
      <Listing label="Skipped after all" count={dropped.length}>
        {dropped.map(({ key, reason }) => (
          <li key={key} className={LINE}>
            <span className="text-ink">{settingLabel(key)}</span>
            <span className="text-ink-faint">{SKIP_REASONS[reason]}</span>
          </li>
        ))}
      </Listing>
      <Listing label="Imported after all" count={added.length}>
        {added.map((key) => (
          <li key={key} className={LINE}>
            <span className="text-ink">{settingLabel(key)}</span>
          </li>
        ))}
      </Listing>
    </div>
  );
}
