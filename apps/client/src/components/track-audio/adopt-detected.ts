import { parseMusicalKey } from "@workspace/session-diff/musical-key";

/**
 * A track's own key and tempo are derived from its main session's
 * `rootNote`/`scale`/`tempo` (`deriveTrackMusicMeta`, `apps/server/src/
 * entities/track/queries.ts`) — there is no field on the track itself to
 * write. Adopting a detected value patches the main session through the same
 * generic patch machinery every other rail field uses (`patchEntityFields` in
 * `entities/mutations.ts`); `DetectedMeta` merges the patches into one body,
 * which is safe because every patch here names the same session.
 */
export type AdoptPatch = {
  entityType: "session";
  entityId: number;
  fieldName: "rootNote" | "scale" | "tempo";
  value: string;
};

/**
 * The patches adopting a detected key writes: the tonic and the mode, split
 * across the two session columns they land on. Null when the stored key
 * string carries no recognisable mode — nothing to write in that case.
 *
 * The estimator's own spelling goes out as it stands; the server normalises a
 * root note and a scale on write (`normaliseRootNote`/`normaliseScale`,
 * `apps/server/src/db/schema/sessions.ts`), so `F♯`/`minor` is stored as
 * `F#`/`Minor` — one spelling per key, whoever wrote it.
 */
export function adoptKeyPatches(
  mainSessionId: number,
  musicalKey: string
): AdoptPatch[] | null {
  const parsed = parseMusicalKey(musicalKey);
  if (!parsed) return null;
  return [
    {
      entityType: "session",
      entityId: mainSessionId,
      fieldName: "rootNote",
      value: parsed.tonic,
    },
    {
      entityType: "session",
      entityId: mainSessionId,
      fieldName: "scale",
      value: parsed.scale,
    },
  ];
}

/** The patch adopting a detected tempo writes: the session's own tempo
 *  field, which — like the track's derived `bpm` — is carried as a string. */
export function adoptTempoPatch(
  mainSessionId: number,
  bpm: number
): AdoptPatch {
  return {
    entityType: "session",
    entityId: mainSessionId,
    fieldName: "tempo",
    value: String(bpm),
  };
}
