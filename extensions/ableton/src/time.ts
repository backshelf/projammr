/** Beat/millisecond conversions and Live cue-point formatting helpers. */

const MS_PER_MINUTE = 60_000;
const CUE_PREFIX = "[projammr]";
const MAX_CUE_NAME = 80;
const BEAT_TOLERANCE = 0.05;

export function beatsToMs(beats: number, tempo: number): number {
  if (!Number.isFinite(beats) || !Number.isFinite(tempo) || tempo <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((beats / tempo) * MS_PER_MINUTE));
}

export function msToBeats(ms: number, tempo: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(tempo) || tempo <= 0) {
    return 0;
  }
  return Math.max(0, (ms / MS_PER_MINUTE) * tempo);
}

/** Formats 0-based beats as Ableton's 1-based `Bar.Beat` (assuming `beatsPerBar`, default 4). */
export function formatBarsBeats(beats: number, beatsPerBar = 4): string {
  const safe = Math.max(0, Number.isFinite(beats) ? beats : 0);
  const bar = Math.floor(safe / beatsPerBar) + 1;
  const beatInBar = (safe % beatsPerBar) + 1;
  const rounded = Math.round(beatInBar * 100) / 100;
  const whole = Math.floor(rounded);
  const frac = Math.round((rounded - whole) * 100);
  return frac === 0 ? `${bar}.${whole}` : `${bar}.${rounded}`;
}

export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatSelectionSummary(
  startBeats: number,
  endBeats: number,
  tempo: number,
  beatsPerBar = 4
): {
  barRange: string;
  timeRange: string;
  positionMs: number;
} {
  const startMs = beatsToMs(startBeats, tempo);
  const endMs = beatsToMs(endBeats, tempo);
  const startBar = formatBarsBeats(startBeats, beatsPerBar);
  const endBar = formatBarsBeats(endBeats, beatsPerBar);
  return {
    barRange:
      Math.abs(endBeats - startBeats) < 0.001
        ? `Bar ${startBar}`
        : `Bars ${startBar}–${endBar}`,
    timeRange:
      endMs <= startMs
        ? formatTimecode(startMs)
        : `${formatTimecode(startMs)}–${formatTimecode(endMs)}`,
    positionMs: startMs,
  };
}

export function formatCueLabel(
  content: string,
  author?: string | null
): string {
  const clean = content.replace(/\s+/g, " ").trim();
  const who = author?.trim();
  const body = who ? `${who}: ${clean}` : clean;
  const full = `${CUE_PREFIX} ${body}`;
  if (full.length <= MAX_CUE_NAME) {
    return full;
  }
  return `${full.slice(0, MAX_CUE_NAME - 1).trimEnd()}…`;
}

export interface ExistingCue {
  time: number;
  name: string;
}

export function hasMatchingCue(
  existing: readonly ExistingCue[],
  beat: number,
  label: string
): boolean {
  return existing.some(
    (cue) =>
      Math.abs(cue.time - beat) <= BEAT_TOLERANCE &&
      cue.name.trim() === label.trim()
  );
}
