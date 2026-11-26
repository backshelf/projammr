import type {
  NewSession,
  SaveMeta,
  SessionStructure,
} from "@workspace/api/api";

/** One sample of a set: its path, where the set says it lives, and whether the producer's machine has it. */
export type DemoSample = NonNullable<NewSession["samples"]>[number];

/** A set's structure with the clip counts every set the seed reads carries. */
export type DemoStructure = SessionStructure & {
  clips: { audio: number; midi: number };
};

/**
 * The set as the seed reads it from `sets/<session>.json` (written by
 * `curate.ts`): what the file says of itself, without the file. Tempo is a
 * number here and a string on the wire.
 */
export interface DemoSet {
  tempo?: number;
  timeSignature?: string;
  rootNote?: string;
  scale?: string;
  tracksCount?: number;
  scenesCount?: number;
  dawVersion?: string;
  samples?: DemoSample[];
  structure?: DemoStructure;
}

/** The set's facts as a session's create body and a save's `meta` carry them: every field present, null when the set has none. */
export function setFacts(set: DemoSet) {
  return {
    tempo: set.tempo != null ? String(set.tempo) : null,
    timeSignature: set.timeSignature ?? null,
    rootNote: set.rootNote ?? null,
    scale: set.scale ?? null,
    tracksCount: set.tracksCount ?? null,
    scenesCount: set.scenesCount ?? null,
    dawVersion: set.dawVersion ?? null,
    structure: set.structure ?? null,
  };
}

/**
 * A save's `meta`: the set's facts with its samples as their paths in order.
 * A pushed save leaves the sample rows alone, so the paths are all it records.
 */
export function saveMeta(set: DemoSet): SaveMeta {
  return {
    ...setFacts(set),
    samplePaths: set.samples?.map((sample) => sample.path) ?? null,
  };
}
