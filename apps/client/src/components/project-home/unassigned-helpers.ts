const DAW_EXT_RE = /\.(als|rpp|logicx|flp|cpr|ptx)$/i;
const TRAILING_PROJECT_RE = /\s+project$/i;
const TRAILING_VERSION_RE = /(?:[\s._-]+(?:v\d+|final|mix\d*|wip|demo\d*))+$/i;

/**
 * Turns a DAW set filename or project folder name into a clean song title:
 * strips DAW extensions, trailing "Project", and trailing version suffixes
 * (`_v3`, `-v12`, ` v2`), and normalises underscores to spaces.
 */
export function cleanSetTitle(rawName: string): string {
  const original = rawName.trim();
  let s = original.replace(DAW_EXT_RE, "").trim();
  s = s.replace(TRAILING_PROJECT_RE, "").trim();
  s = s.replace(TRAILING_VERSION_RE, "").trim();
  s = s
    .replace(/_+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || original;
}

function normaliseTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function bigrams(str: string): Set<string> {
  const clean = str.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    out.add(clean.slice(i, i + 2));
  }
  return out;
}

function diceSimilarity(a: string, b: string): number {
  const aClean = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bClean = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!aClean || !bClean) return 0;
  if (aClean === bClean) return 1;
  if (aClean.includes(bClean) || bClean.includes(aClean)) {
    return (
      0.85 *
      (Math.min(aClean.length, bClean.length) /
        Math.max(aClean.length, bClean.length))
    );
  }
  const ba = bigrams(aClean);
  const bb = bigrams(bClean);
  if (ba.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

/**
 * Fuzzy-matches a DAW set name against existing project tracks to hoist the
 * best candidate as "Suggested match" in the Link to track picker.
 */
export function suggestTrackMatch<T extends { id: number; title: string }>(
  setName: string,
  tracks: readonly T[]
): (T & { score: number }) | null {
  const cleaned = cleanSetTitle(setName);
  const setTokens = new Set(normaliseTokens(cleaned));
  let best: (T & { score: number }) | null = null;

  for (const track of tracks) {
    const trackTokens = normaliseTokens(track.title);
    let tokenOverlap = 0;
    if (setTokens.size > 0 && trackTokens.length > 0) {
      let hits = 0;
      for (const tok of trackTokens) if (setTokens.has(tok)) hits++;
      tokenOverlap = hits / Math.max(setTokens.size, trackTokens.length);
    }
    const dice = diceSimilarity(cleaned, track.title);
    const score = Math.max(dice, tokenOverlap * 0.9);
    if (score >= 0.45 && (!best || score > best.score)) {
      best = { ...track, score };
    }
  }

  return best;
}
