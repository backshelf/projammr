import type { SaveMeta } from "./meta.js";
import { defaultDiffFormat, type DiffFormat } from "./format.js";
import { clipsFacet } from "./clips.js";
import { dawVersionFacet } from "./daw-version.js";
import type { DiffChip, Facet, FacetChange, Readout } from "./facet.js";
import { keyFacet } from "./key.js";
import {
  NO_SAMPLE_CHANGE,
  type SampleDelta,
  sampleDelta,
  samplesFacet,
} from "./samples.js";
import { scenesFacet } from "./scenes.js";
import {
  diffStructure,
  type StructureDiff,
  structureFacet,
} from "./structure.js";
import { tempoFacet } from "./tempo.js";
import { timeSignatureFacet } from "./time-signature.js";

export type {
  DiffChip,
  DiffChipKind,
  Facet,
  FacetChange,
  Readout,
} from "./facet.js";
export { keyOf } from "./key.js";
export type { SampleDelta } from "./samples.js";
export {
  type DeviceRow,
  diffStructure,
  pairRenames,
  partitionTracks,
  type StructureDiff,
  type TrackRow,
} from "./structure.js";

/**
 * Everything a save can change, in the order its changes read: the musical
 * fields first, then the set's shape, then its contents, then the DAW that
 * saved it.
 */
export const FACETS: readonly Facet[] = [
  tempoFacet,
  timeSignatureFacet,
  keyFacet,
  structureFacet,
  clipsFacet,
  scenesFacet,
  samplesFacet,
  dawVersionFacet,
];

/**
 * Whether a DAW claims `capability`. A session whose claims were never
 * recorded (none given, or an empty list, as on a session scanned before
 * DAWs declared them) is taken at its word for whatever its saves carry.
 */
const claims = (
  capabilities: readonly string[] | undefined,
  capability: string
): boolean =>
  !capabilities ||
  capabilities.length === 0 ||
  capabilities.includes(capability);

/** The facets a DAW can fill. */
const facetsFor = (capabilities?: readonly string[]): readonly Facet[] =>
  FACETS.filter((facet) => claims(capabilities, facet.capability));

function compareAll(
  facets: readonly Facet[],
  before: SaveMeta,
  after: SaveMeta,
  format: DiffFormat
): FacetChange[] {
  return facets.flatMap((facet) => facet.compare(before, after, format) ?? []);
}

/**
 * What changed between two saves of a session, worded for display in the
 * viewer's `format` (the defaults for a page with no viewer) and in `FACETS`
 * order. A save with nothing before it is the start of the history
 * rather than a change to anything. `capabilities` limits the comparison to
 * what the session's DAW says it reports.
 */
export function diffSaves(
  before: SaveMeta | null,
  after: SaveMeta,
  capabilities?: readonly string[],
  format: DiffFormat = defaultDiffFormat()
): DiffChip[] {
  if (!before) return [{ kind: "first", label: "First save seen" }];
  return compareAll(facetsFor(capabilities), before, after, format).flatMap(
    (change) => change.chips
  );
}

/** One save compared with the one before it, as the save diff card draws it. */
export type SaveDiff = {
  /** Nothing before this save: the set as first seen, with nothing marked. */
  first: boolean;
  /** Whether anything a facet reads moved. */
  changed: boolean;
  /** Every change, worded. */
  chips: DiffChip[];
  /** The values that moved, each on its gauge, in `FACETS` order. */
  readouts: Readout[];
  /** The set's tracks, or null when the DAW does not list them or this save has none. */
  structure: StructureDiff | null;
  samples: SampleDelta;
  /** Whether the DAW reports track colours, so every row keeps a place for one. */
  colors: boolean;
};

/** How many of a set's tracks a save touched: added, removed, renamed or changed. */
export const changedTrackCount = (structure: StructureDiff | null): number =>
  structure?.rows.filter((row) => row.status !== "same").length ?? 0;

/**
 * The card's whole model of one save against the one before it (`before`
 * null for the first save seen), limited to what the DAW reports and worded
 * in the viewer's `format`.
 */
export function diffSave(
  before: SaveMeta | null,
  after: SaveMeta,
  capabilities: readonly string[],
  format: DiffFormat = defaultDiffFormat()
): SaveDiff {
  const changes = before
    ? compareAll(facetsFor(capabilities), before, after, format)
    : [];
  const listsTracks =
    claims(capabilities, structureFacet.capability) && after.structure != null;

  return {
    first: before == null,
    changed: changes.length > 0,
    chips: changes.flatMap((change) => change.chips),
    readouts: changes.flatMap((change) => change.readout ?? []),
    structure: listsTracks ? diffStructure(before, after) : null,
    samples:
      before && claims(capabilities, samplesFacet.capability)
        ? sampleDelta(before, after)
        : NO_SAMPLE_CHANGE,
    // A colour is only there because a module read it, so a column of
    // swatches waits for the claim itself.
    colors: capabilities.includes("trackColors"),
  };
}
