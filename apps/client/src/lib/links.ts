import type { Link } from "@workspace/api/api";

/** The list with the link at `index` swapped for `link`; every other link keeps its place. */
export function replaceLinkAt(
  links: Link[],
  index: number,
  link: Link
): Link[] {
  return links.map((existing, i) => (i === index ? link : existing));
}

/** The list without the link at `index`. */
export function removeLinkAt(links: Link[], index: number): Link[] {
  return links.filter((_, i) => i !== index);
}

/**
 * A React key per link. Two links may share a URL, so the URL alone repeats:
 * each key carries how many links before it had the same one.
 */
export function linkKeys(links: Link[]): string[] {
  const seen = new Map<string, number>();
  return links.map(({ url }) => {
    const before = seen.get(url) ?? 0;
    seen.set(url, before + 1);
    return `${url}#${before}`;
  });
}

/** Prefixes `https://` when the address carries no scheme. */
export function normaliseUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}
