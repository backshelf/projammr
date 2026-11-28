import type { TodayRender } from "./playable";

export type GroupedRender = {
  latest: TodayRender;
  versions: number[];
  versionLabel: string;
};

export function formatVersionRange(versions: readonly number[]): string {
  if (versions.length === 0) return "";
  if (versions.length === 1) return `v${versions[0]}`;
  const sorted = [...new Set(versions)].sort((a, b) => a - b);
  if (sorted.length === 1) return `v${sorted[0]}`;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (max - min === sorted.length - 1) {
    return `v${min}–v${max}`;
  }
  return sorted.map((v) => `v${v}`).join(", ");
}

/**
 * Collapses repeated renders for the same track in the NEW window into one row
 * carrying the newest version for playback and a concise range label (`v3–v4`).
 */
export function groupTodayRenders(
  renders: readonly TodayRender[]
): GroupedRender[] {
  const byTrack = new Map<
    number,
    { latest: TodayRender; versions: number[] }
  >();
  const order: number[] = [];

  for (const row of renders) {
    const existing = byTrack.get(row.trackId);
    if (!existing) {
      order.push(row.trackId);
      byTrack.set(row.trackId, { latest: row, versions: [row.version] });
    } else {
      existing.versions.push(row.version);
      if (row.version > existing.latest.version) {
        existing.latest = row;
      }
    }
  }

  return order.map((trackId) => {
    const group = byTrack.get(trackId)!;
    return {
      latest: group.latest,
      versions: group.versions,
      versionLabel: formatVersionRange(group.versions),
    };
  });
}
