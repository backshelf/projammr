import { getTableColumns } from "drizzle-orm";
import { z } from "zod";
import {
  clipSchema,
  LAZY_TRACK_AUDIO_COLUMNS,
  sectionSchema,
  spectrumSchema,
  trackAudios,
} from "../../db/schema/tracks.js";

/**
 * The lazily-served track-audio columns, one entry per name: the column a
 * measure reads from and the schema its value answers as. `GET
 * /track-audios/:id/measures/:measure` is the only reader of a big
 * `track_audios` column — everything else selects it out explicitly so a
 * normal read never carries it.
 */
export const TRACK_AUDIO_MEASURES = {
  peaks: { column: trackAudios.audioPeaks, schema: z.array(z.number()) },
  spectrum: { column: trackAudios.ltas, schema: spectrumSchema },
  sections: { column: trackAudios.sections, schema: z.array(sectionSchema) },
  loudnessCurve: {
    column: trackAudios.loudnessCurve,
    schema: z.array(z.number().nullable()),
  },
  correlationCurve: {
    column: trackAudios.correlationCurve,
    schema: z.array(z.number()),
  },
  clipping: { column: trackAudios.clipping, schema: z.array(clipSchema) },
  pitchTrack: { column: trackAudios.pitchTrack, schema: z.array(z.number()) },
} as const;

export type MeasureName = keyof typeof TRACK_AUDIO_MEASURES;

/** The registry's keys, mirrored into `packages/api` as the measure enum. */
export const MEASURE_NAMES = Object.keys(TRACK_AUDIO_MEASURES) as MeasureName[];

/**
 * Every column this registry names must be exactly the schema's own lazy-
 * column list — the columns a normal `track_audios` read omits. Checked once
 * at load time rather than left to drift silently: a column added to one list
 * and not the other would otherwise either leak a big column into every read,
 * or serve a column the read schema doesn't carry.
 */
(function checkRegistryMatchesLazyColumns() {
  const keyByColumn = new Map(
    Object.entries(getTableColumns(trackAudios)).map(([key, column]) => [
      column,
      key,
    ])
  );
  const registered = new Set(
    Object.values(TRACK_AUDIO_MEASURES).map((measure) =>
      keyByColumn.get(measure.column)
    )
  );
  const lazy = new Set<string>(LAZY_TRACK_AUDIO_COLUMNS);

  const matches =
    registered.size === lazy.size &&
    [...registered].every((key) => key != null && lazy.has(key));

  if (!matches) {
    throw new Error(
      "TRACK_AUDIO_MEASURES and trackAudios' lazy-column list have drifted apart"
    );
  }
})();
