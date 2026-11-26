"use client";

import { toastActionResult } from "@/lib/action-toast";
import { IconUpload } from "@tabler/icons-react";
import type { SettingsExport, SettingsImportReport } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useRef, useState } from "react";
import { importSettings } from "../api";
import { useHub } from "../hub-rows";
import {
  importDrift,
  ImportPreview,
  previewOf,
  type ImportFlowState,
} from "./ImportPreview";

/** A file's text as JSON, or why an import cannot take it. */
async function readJson(
  file: File
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      message: "Couldn't read this file. Choose it again, or another one.",
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      message:
        "This file isn't JSON, so it isn't a settings export. Choose the .json file an export downloaded.",
    };
  }
}

/**
 * Why the server refused a file (its 400): the export's format, when the
 * file names one this instance does not read, or that it is no export at all.
 */
function refusalOf(file: unknown, failure: ActionError): string {
  const issues = failure.details?.issues;
  const refusedVersion =
    Array.isArray(issues) &&
    issues.some(
      (issue: { path?: unknown }) =>
        Array.isArray(issue.path) && issue.path[0] === "version"
    );
  const version =
    typeof file === "object" && file !== null && "version" in file
      ? (file as { version: unknown }).version
      : undefined;
  if (refusedVersion && version !== undefined) {
    return `This export is in a format this instance doesn't read (version ${JSON.stringify(version)}).`;
  }
  return "This file isn't a Projammr settings export.";
}

/**
 * Why the real import failed. The server applies a file in one transaction,
 * so a refusal it answered with changed nothing; with no answer at all the
 * import may have landed, and importing the same file again is harmless.
 */
function unappliedMessage(failure: ActionError): string {
  return failure.status === undefined
    ? `${failure.error}: the import may or may not have gone through. Trying again is safe; importing the same file twice changes nothing more.`
    : `Nothing was imported. ${failure.error}`;
}

/** The toast an import ends with: what it applied and skipped. */
function importedMessage(
  report: SettingsImportReport,
  { shown }: { shown: boolean }
): string {
  const skipped = report.skipped.length;
  return [
    `Imported ${pluralizeCount(report.applied.length, "setting")}`,
    skipped > 0 ? `, skipped ${skipped}` : "",
    shown ? "" : ". Reload the page to see them here",
  ].join("");
}

/**
 * Import for the user's own settings: a file picker, then a dry run whose
 * preview shows what the file would change and skip, then the real import,
 * after which the page's rows and every settings reader take the server's
 * values before the toast says what was imported. A file the server refuses
 * (not JSON, not an export, a format it does not read) is a message in the
 * dialog, and a failure at any step leaves the flow where it can go on.
 */
export function ImportFlow() {
  const hub = useHub();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [flow, setFlow] = useState<ImportFlowState>({ phase: "closed" });
  // Every file chosen and every close starts a new run; an answer that
  // arrives for an older run is dropped.
  const runRef = useRef(0);

  const target = hub.target("user");
  if (target?.scope !== "user") return null;
  const userId = target.id;

  const check = async (ticket: number, fileName: string, value: unknown) => {
    setFlow({ phase: "checking", fileName });
    const report = await importSettings(userId, value, { dryRun: true });
    if (ticket !== runRef.current) return;
    if (isActionError(report)) {
      setFlow(
        report.status === 400
          ? { phase: "refused", fileName, message: refusalOf(value, report) }
          : { phase: "unchecked", fileName, file: value, message: report.error }
      );
      return;
    }
    // The server took the file, so it is an export.
    const file = value as SettingsExport;
    setFlow({
      phase: "preview",
      fileName,
      file,
      preview: previewOf(report, file, (key) => hub.store.row(key)),
    });
  };

  const open = async (chosen: File) => {
    const ticket = ++runRef.current;
    setFlow({ phase: "checking", fileName: chosen.name });
    const read = await readJson(chosen);
    if (ticket !== runRef.current) return;
    if (!read.ok) {
      setFlow({
        phase: "refused",
        fileName: chosen.name,
        message: read.message,
      });
      return;
    }
    await check(ticket, chosen.name, read.value);
  };

  const apply = async () => {
    if (flow.phase !== "preview" && flow.phase !== "unapplied") return;
    const checked = {
      fileName: flow.fileName,
      file: flow.file,
      preview: flow.preview,
    };
    setFlow({ phase: "applying", ...checked });
    const report = await importSettings(userId, checked.file, {
      dryRun: false,
    });
    if (isActionError(report)) {
      // With no answer the import may have landed: the page shows whatever
      // the server now holds.
      if (report.status === undefined) {
        await Promise.all([hub.store.reread(), hub.refresh()]);
      }
      setFlow({
        phase: "unapplied",
        ...checked,
        message: unappliedMessage(report),
      });
      return;
    }
    const [shown] = await Promise.all([hub.store.reread(), hub.refresh()]);
    toastActionResult({
      ok: true,
      message: importedMessage(report, { shown }),
    });
    const drift = importDrift(checked.preview.report, report);
    setFlow(
      drift
        ? { phase: "drifted", ...checked, report, drift }
        : { phase: "closed" }
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => pickerRef.current?.click()}
      >
        <IconUpload aria-hidden data-icon="inline-start" />
        Import settings
      </Button>
      <input
        ref={pickerRef}
        type="file"
        accept=".json,application/json"
        aria-label="Settings file to import"
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          // Cleared so choosing the same file again is a change too.
          event.target.value = "";
          if (chosen) void open(chosen);
        }}
      />
      <ImportPreview
        flow={flow}
        actions={{
          apply: () => void apply(),
          retry: () => {
            if (flow.phase === "unchecked") {
              void check(runRef.current, flow.fileName, flow.file);
            }
          },
          chooseAnother: () => pickerRef.current?.click(),
          close: () => {
            ++runRef.current;
            setFlow({ phase: "closed" });
          },
        }}
      />
    </>
  );
}
