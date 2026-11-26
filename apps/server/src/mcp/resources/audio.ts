import type { AudioAudit } from "../../db/queries/track-audios.js";
import { requireProject } from "../authorize.js";
import { defineResource } from "../spec.js";
import { auditWithFindings } from "../tools/audio.js";

const SEVERITY_ORDER = ["error", "warn", "info"] as const;

const SEVERITY_HEADING: Record<(typeof SEVERITY_ORDER)[number], string> = {
  error: "Errors",
  warn: "Warnings",
  info: "Info",
};

/** `null` as the em dash a markdown table reads better than an empty cell. */
function cell(value: string | number | null): string {
  return value == null ? "—" : String(value);
}

/**
 * Renders an {@link AudioAudit} as the markdown report the resource serves:
 * its findings grouped by severity as bullets, then one table per track of
 * its versions (version, file, duration, LUFS, true peak, analysed,
 * sessions). Pure — no I/O — so it is unit-testable on a hand-built audit.
 */
export function auditMarkdown(audit: AudioAudit): string {
  const lines: string[] = ["# Audio audit", ""];

  if (audit.findings.length === 0) {
    lines.push("No findings.", "");
  } else {
    for (const severity of SEVERITY_ORDER) {
      const findings = audit.findings.filter((f) => f.severity === severity);
      if (findings.length === 0) continue;
      lines.push(`## ${SEVERITY_HEADING[severity]}`, "");
      for (const finding of findings) {
        const fix = finding.fix ? ` (fix: \`${finding.fix}\`)` : "";
        lines.push(`- **${finding.code}** — ${finding.message}${fix}`);
      }
      lines.push("");
    }
  }

  lines.push("## Tracks", "");
  for (const track of audit.tracks) {
    lines.push(`### ${track.title} (track ${track.trackId})`, "");
    if (track.versions.length === 0) {
      lines.push("No versions.", "");
      continue;
    }
    lines.push(
      "| Version | File | Duration | LUFS | True peak | Lead silence | Tail silence | Clipped bins | BPM | Key | Analysed | Sessions |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    );
    for (const version of track.versions) {
      const durationS =
        version.analysis.durationMs != null
          ? (version.analysis.durationMs / 1000).toFixed(1) + "s"
          : null;
      const leadS =
        version.analysis.silence != null
          ? (version.analysis.silence.leadMs / 1000).toFixed(1) + "s"
          : null;
      const tailS =
        version.analysis.silence != null
          ? (version.analysis.silence.tailMs / 1000).toFixed(1) + "s"
          : null;
      const clippedBins =
        version.analysis.clippedBins > 0 ? version.analysis.clippedBins : null;
      const sessions = version.sessions.map((s) => s.name).join(", ") || "—";
      lines.push(
        `| v${version.version}${version.isPrimary ? " (primary)" : ""} | ${version.asset.name} | ${cell(durationS)} | ${cell(version.analysis.lufs)} | ${cell(version.analysis.truePeakDb)} | ${cell(leadS)} | ${cell(tailS)} | ${cell(clippedBins)} | ${cell(version.analysis.bpm)} | ${cell(version.analysis.musicalKey)} | ${version.analysis.current ? "yes" : "no"} | ${sessions} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** The audio-audit markdown report, read-gated at viewer like `audit_audio`. */
export const AUDIO_RESOURCES = [
  defineResource({
    template: "projammr://projects/{projectId}/audio-audit",
    name: "audio-audit",
    title: "Project audio audit",
    description:
      "The project's audio audit as a markdown report: findings grouped by" +
      " severity, then a per-track table of versions.",
    mimeType: "text/markdown",
    read: async (actor, params) => {
      const projectId = Number(params.projectId);
      await requireProject(actor, projectId, "viewer");
      const audit = await auditWithFindings(projectId);
      return auditMarkdown(audit);
    },
  }),
];
