/** Two spellings name the same artist when they differ only in case. */
const sameArtist = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

/**
 * Each credit with a key unique among them. The table's comma-separated
 * editor can credit one artist twice, so a repeat is keyed by its occurrence.
 */
export function keyedCredits(
  credited: readonly string[]
): { artist: string; key: string }[] {
  const seen = new Map<string, number>();
  return credited.map((artist) => {
    const nth = (seen.get(artist) ?? 0) + 1;
    seen.set(artist, nth);
    return { artist, key: nth === 1 ? artist : `${artist}#${nth}` };
  });
}

/**
 * What the artist picker offers for a draft: the project's artists the track
 * does not credit yet whose names contain the draft, and the draft itself as
 * a new artist when no existing name matches it ignoring case.
 */
export function artistOptions(
  vocabulary: readonly string[],
  credited: readonly string[],
  draft: string
): { matches: string[]; create: string | null } {
  const name = draft.trim();
  const query = name.toLowerCase();
  const matches = vocabulary.filter(
    (artist) =>
      !credited.some((c) => sameArtist(c, artist)) &&
      artist.toLowerCase().includes(query)
  );
  const known = [...vocabulary, ...credited].some((a) => sameArtist(a, name));
  return { matches, create: name && !known ? name : null };
}

/**
 * The credits after adding `name`, spelt the way the project already spells
 * it when an existing artist matches ignoring case, so the tracks list's
 * exact-match artist filter finds every track under one spelling. Returns
 * `credited` itself when there is nothing to add.
 */
export function creditArtist(
  vocabulary: readonly string[],
  credited: string[],
  name: string
): string[] {
  const trimmed = name.trim();
  if (!trimmed || credited.some((c) => sameArtist(c, trimmed))) return credited;
  const spelling = vocabulary.find((a) => sameArtist(a, trimmed)) ?? trimmed;
  return [...credited, spelling];
}
