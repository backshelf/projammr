import {
  diffStructure,
  type StructureDiff,
  type TrackRow,
} from "@workspace/session-diff";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { SaveMeta } from "@workspace/session-diff/meta";

import type { SetMeta, StructureTrack } from "../ipc";

/** The typographic minus the save chips use, so a removed device reads as the web's chips do. */
const MINUS = "\u2212";

/** A set as the script reports it mid-session: the tracks and nothing else, in the shape a save's meta has. */
function liveMeta(tracks: readonly StructureTrack[]): SaveMeta {
  return { structure: { tracks: [...tracks] } };
}

/**
 * The tracks the skyline draws, each row's status saying how it differs from the last commit. The set is the
 * script's latest `tracks` message when it has sent one (the changes before they are saved), else the newest save;
 * the commit is `head`, and a set with none has every track new. A track whose content changed but whose devices did
 * not (a clip, a note, an automation lane) is `same` to the device diff, so the names the app read from the part
 * digests promote it to `changed`. Null while there is no set to draw.
 */
export function skylineStructure({
  head,
  latest,
  live,
  changed,
}: {
  head: SetMeta | null;
  latest: SetMeta | null;
  live: readonly StructureTrack[] | null;
  changed: readonly string[];
}): StructureDiff | null {
  const now: SaveMeta | null = live ? liveMeta(live) : latest;
  if (!now?.structure) return null;
  const before = head ?? liveMeta([]);
  const diff = diffStructure(before, now);
  const edited = new Set(changed);
  return {
    ...diff,
    rows: diff.rows.map((row) =>
      row.status === "same" && edited.has(row.name)
        ? { ...row, status: "changed" as const }
        : row
    ),
  };
}

/** The rows the skyline lights: every one that is not as the last commit had it. */
export function litRows(structure: StructureDiff): TrackRow[] {
  return structure.rows.filter((row) => row.status !== "same");
}

/** What happened to one track, as the readout words it: "+EQ Eight", "added", "edited". Empty for an unchanged one. */
function changeOf(row: TrackRow): string {
  switch (row.status) {
    case "same":
      return "";
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
    case "changed": {
      const devices = row.devices
        .filter((device) => device.status !== "same")
        .map(
          (device) => `${device.status === "added" ? "+" : MINUS}${device.name}`
        );
      if (row.status === "renamed") {
        return [`was ${row.was ?? ""}`.trimEnd(), ...devices].join(", ");
      }
      return devices.length > 0 ? devices.join(", ") : "edited";
    }
  }
}

/** One track as the readout names it: "Bass · +EQ Eight" lit, "Pad · 2 devices" or just "Pad" when it is as it was. */
export function describeRow(row: TrackRow): string {
  const change = changeOf(row);
  if (change !== "") return `${row.name} \u00b7 ${change}`;
  return row.devices.length > 0
    ? `${row.name} \u00b7 ${pluralizeCount(row.devices.length, "device")}`
    : row.name;
}

/** The line the readout holds while no track is pointed at: how many tracks are lit. */
export function summarize(
  structure: StructureDiff,
  committed: boolean
): string {
  if (!committed) {
    return `${pluralizeCount(structure.rows.length, "track")}, none committed yet`;
  }
  const lit = litRows(structure).length;
  return lit === 0
    ? "No track has changed since the last commit"
    : `${pluralizeCount(lit, "track")} changed since the last commit`;
}
