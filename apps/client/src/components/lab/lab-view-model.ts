/**
 * Framework-free copy and section-state helpers for {@link LabView}: what the
 * preparing and unavailable states say, which sliders a time/pitch mode
 * shows, and the figures beside them. Kept apart from the components so they
 * are testable under `bun test`'s no-DOM environment.
 */

import type { LabSource } from "@/components/music-player/player-engine";
import type { LabState } from "@/components/music-player/player-store";
import type { SpeedPitchMode } from "@/lib/dsp/lab-settings";

const PREPARING_LABEL: Record<LabSource, string> = {
  original: "Preparing the Lab",
  copy: "Preparing a 320 kbps copy",
};

export type PreparingCopy = {
  /** What is downloading. */
  label: string;
  /** 0..100, rounded for display. */
  percent: number;
  /** The full line the meter carries, e.g. "Preparing the Lab · 42%". */
  line: string;
};

/** What the TIME & PITCH block shows while the Lab downloads and decodes. */
export function preparingCopy(
  lab: Pick<LabState, "source" | "fraction">
): PreparingCopy {
  const label = PREPARING_LABEL[lab.source];
  const percent = Math.max(0, Math.min(100, Math.round(lab.fraction * 100)));
  return { label, percent, line: `${label} · ${percent}%` };
}

/** What the TIME & PITCH block shows when the Lab could not start. */
export function unavailableCopy(lab: Pick<LabState, "reason">): string {
  return lab.reason ?? "The Lab could not start here";
}

/** The speed figure beside its slider, e.g. "0.85×". */
export const speedFigure = (speed: number) => `${speed.toFixed(2)}×`;

/** The pitch figure beside its slider, e.g. "+2 st" or "−3.5 st". */
export function pitchFigure(pitch: number): string {
  const rounded = Math.round(pitch * 10) / 10;
  if (rounded === 0) return "0 st";
  const magnitude = Number.isInteger(rounded)
    ? Math.abs(rounded).toFixed(0)
    : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : "−"}${magnitude} st`;
}

/**
 * Whether the speed slider means anything in `mode`: pitch-only mode pins
 * playback speed to 1, so moving it would change nothing (see
 * `playbackSpeed` in `lab-settings.ts`).
 */
export const showsSpeedSlider = (mode: SpeedPitchMode) => mode !== "pitch";

/**
 * Whether the pitch slider means anything in `mode`: speed-only and linked
 * modes hold pitch at 0 (linked moves it with speed instead of on its own),
 * so only pitch-only and independent modes offer it.
 */
export const showsPitchSlider = (mode: SpeedPitchMode) =>
  mode === "pitch" || mode === "independent";

/**
 * Whether the time/pitch sliders show at all: they give way to the preparing
 * meter or the unavailable copy while the Lab isn't live, per DESIGN.md's
 * Lab paragraph ("a Meter or a line of copy takes their place"). The rest of
 * the Lab view — mode, rack, auditions — stays editable regardless.
 */
export const slidersReady = (phase: LabState["phase"]) =>
  phase !== "preparing" && phase !== "unavailable";

/** A Match EQ candidate: another version with a spectrum to match toward. */
export type MatchEqReference = {
  audioId: number;
  /** What the option reads in the select — "mix-final.wav · v3", say. */
  label: string;
};

/**
 * What a Match EQ reference option reads: the file behind the version, since
 * the version number alone doesn't say which mix it was — the ID helps no
 * one.
 */
export function matchEqReferenceLabel(audio: {
  version: number;
  asset: { name: string };
}): string {
  return `${audio.asset.name} · v${audio.version}`;
}

/**
 * Whether the Match EQ row has anything to offer: at least one reference
 * besides the version currently playing carries a stored spectrum.
 */
export function matchEqAvailable(references: MatchEqReference[]): boolean {
  return references.length > 0;
}

/** Normalise is only offered once the version has a stored loudness figure. */
export const normaliseAvailable = (lufs: number | null) => lufs != null;
