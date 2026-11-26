import type { SaveMeta, SessionTrack } from "@workspace/api/api";
import { type DemoSet, type DemoStructure, saveMeta } from "./demo-set";
import type { DemoSaveMilestone, DemoSession } from "./model";

/**
 * One save of a session, as the seed pushes it. A milestone is one of the
 * catalogue's, and closes a commit with its message; a save `between` is an
 * evening's work on the way to the next.
 */
export type HistoricSave = {
  fileUpdatedAt: number;
  meta: SaveMeta;
} & ({ kind: "milestone"; message: string } | { kind: "between" });

/**
 * Moves a set's absolute sample paths from the machine it was saved on into
 * `home`, the way they would read had the set been saved there.
 */
export const rebaseHome = (paths: string[], home: string) =>
  paths.map((p) => p.replace(/^\/(Users|home)\/[^/]+/, home));

const DAY = 86_400_000;

/** The UTC offset an ISO timestamp is written in (`+10:00`), in ms; zero for `Z` or none. */
export function utcOffsetMs(iso: string): number {
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -minutes : minutes) * 60_000;
}

/** Deterministic PRNG (mulberry32), so a reseed lays the saves out the same way. */
function random(seed: string) {
  let a = [...seed].reduce(
    (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
    2166136261
  );
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function topLevelOf(tracks: SessionTrack[]) {
  const byId = new Map(
    tracks.filter((t) => t.id != null).map((t) => [t.id, t])
  );
  return (track: SessionTrack): SessionTrack => {
    let current = track;
    for (
      let parent = byId.get(current.groupId);
      parent;
      parent = byId.get(current.groupId)
    ) {
      current = parent;
    }
    return current;
  };
}

/** The set's structure as it stood at a milestone: fewer tracks, fewer devices. */
function structureAt(
  set: DemoStructure,
  milestone: DemoSaveMilestone
): DemoStructure {
  const root = topLevelOf(set.tracks);
  const topLevel = new Set(milestone.topLevel);
  const tracks = set.tracks
    .filter((t) =>
      t.kind === "return" ? milestone.returns : topLevel.has(root(t).name)
    )
    .map((t) => {
      const missing = [...(milestone.missingDevices?.[t.name] ?? [])];
      if (!missing.length) return t;
      const devices = t.devices.filter((d) => {
        const at = missing.indexOf(d);
        if (at === -1) return true;
        missing.splice(at, 1);
        return false;
      });
      return { ...t, devices };
    });
  const used = new Set(tracks.flatMap((t) => t.devices));
  const plugins = set.plugins
    ? Object.fromEntries(
        Object.entries(set.plugins).filter(([name]) => used.has(name))
      )
    : undefined;
  return {
    ...set,
    tracks,
    ...(plugins && Object.keys(plugins).length
      ? { plugins }
      : { plugins: undefined }),
  };
}

/** Throws when a milestone names a top-level track or device the set does not have. */
function assertMilestones(set: DemoStructure, session: DemoSession) {
  const root = topLevelOf(set.tracks);
  const topLevel = new Set(
    set.tracks
      .filter((t) => t.kind !== "return" && root(t) === t)
      .map((t) => t.name)
  );
  for (const milestone of session.history) {
    for (const name of milestone.topLevel) {
      if (!topLevel.has(name)) {
        throw new Error(
          `${session.key}: the set has no top-level track "${name}"`
        );
      }
    }
    for (const [name, devices] of Object.entries(
      milestone.missingDevices ?? {}
    )) {
      const track = set.tracks.find((t) => t.name === name);
      const missing = devices.filter((d) => !track?.devices.includes(d));
      if (!track || missing.length) {
        throw new Error(
          `${session.key}: "${name}" has no device ${missing.join(", ") || "(track missing)"}`
        );
      }
    }
  }
}

/**
 * Every save of the session before its current one, oldest first: one per
 * milestone, then `saves` more between it and the next milestone (or the
 * current save), spread over evenings on the days between. A milestone shows
 * its own tracks, devices and tempo; the saves after it add clips and samples
 * towards the next one, so every save carries something the diff can show.
 */
export function buildHistory(
  set: DemoSet,
  session: DemoSession
): HistoricSave[] {
  const structure = set.structure;
  if (!structure)
    throw new Error(
      `${session.key}: the set has no structure to build a history from`
    );
  assertMilestones(structure, session);

  const next = random(session.key);
  const samples = set.samples ?? [];
  const nonReturns = structure.tracks.filter((t) => t.kind !== "return").length;
  const finalState = {
    at: Date.parse(session.savedAt),
    structure,
    clips: structure.clips,
    samples: samples.length,
    tracksCount: set.tracksCount ?? nonReturns,
  };

  const states = session.history.map((milestone, i) => {
    const s = structureAt(structure, milestone);
    const share =
      s.tracks.filter((t) => t.kind !== "return").length / nonReturns;
    const growth = 0.5 + (0.5 * (i + 1)) / (session.history.length + 1);
    return {
      at: Date.parse(milestone.at),
      milestone,
      structure: s,
      clips: {
        audio: Math.round(structure.clips.audio * share * growth),
        midi: Math.round(structure.clips.midi * share * growth),
      },
      samples: Math.round(samples.length * share * growth),
      tracksCount: Math.round(finalState.tracksCount * share),
    };
  });

  const meta = (
    state: (typeof states)[number],
    clips: DemoStructure["clips"],
    sampleCount: number
  ) =>
    saveMeta({
      ...set,
      tempo: state.milestone.tempo,
      tracksCount: state.tracksCount,
      samples: samples.slice(0, sampleCount),
      structure: { ...state.structure, clips },
    });

  const offset = utcOffsetMs(session.savedAt);
  const saves: HistoricSave[] = [];
  states.forEach((state, i) => {
    const target = states[i + 1] ?? finalState;
    saves.push({
      fileUpdatedAt: state.at,
      kind: "milestone",
      message: state.milestone.message,
      meta: meta(state, state.clips, state.samples),
    });
    const span = target.at - state.at;
    for (let k = 1; k <= state.milestone.saves; k++) {
      const progress = k / (state.milestone.saves + 1);
      const slot = state.at + span * progress;
      const jitter =
        (next() - 0.5) * (span / (state.milestone.saves + 1)) * 0.6;
      // An evening on the producer's clock somewhere in this save's slice of
      // the span, never on or past a neighbouring milestone.
      const day = Math.floor((slot + jitter + offset) / DAY) * DAY - offset;
      const evening = day + (18 * 60 + Math.floor(next() * 330)) * 60_000;
      const at = Math.min(
        target.at - 60_000,
        Math.max(state.at + 60_000, evening)
      );
      const lerp = (from: number, to: number) =>
        Math.round(from + (to - from) * progress);
      saves.push({
        fileUpdatedAt: Math.round(at / 60_000) * 60_000,
        kind: "between",
        meta: meta(
          state,
          {
            audio: lerp(state.clips.audio, target.clips.audio),
            midi: lerp(state.clips.midi, target.clips.midi),
          },
          lerp(state.samples, target.samples)
        ),
      });
    }
  });

  saves.sort((a, b) => a.fileUpdatedAt - b.fileUpdatedAt);
  return saves.filter(
    (s, i) => i === 0 || s.fileUpdatedAt !== saves[i - 1]!.fileUpdatedAt
  );
}
