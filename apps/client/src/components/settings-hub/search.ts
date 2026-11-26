import { SETTINGS, type SettingKey } from "@workspace/settings";

/** Each setting's searchable text, lower-cased once: label, description and keywords. */
const haystacks = new Map<SettingKey, string>();

function haystackOf(key: SettingKey): string {
  let haystack = haystacks.get(key);
  if (haystack === undefined) {
    const { label, description, keywords } = SETTINGS[key];
    haystack = [label, description, ...keywords].join("\n").toLowerCase();
    haystacks.set(key, haystack);
  }
  return haystack;
}

/**
 * The entries whose setting matches `query`: every word of it appears in the
 * setting's label, description or keywords, in any order and any case. A
 * query with no words matches nothing.
 */
export function searchSettings<E extends { key: SettingKey }>(
  entries: readonly E[],
  query: string
): E[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries.filter((entry) => {
    const haystack = haystackOf(entry.key);
    return words.every((word) => haystack.includes(word));
  });
}
