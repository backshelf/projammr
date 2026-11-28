/**
 * Replaces a leading `home` directory prefix with `~/` for compact display in the 400px panel.
 * Leaves paths outside `home` untouched.
 */
export function shortenHome(path: string, home?: string | null): string {
  if (!home) return path;
  const clean = home.replace(/[\\/]+$/, "");
  if (clean === "") return path;
  if (path === clean) return "~/";
  if (path.startsWith(`${clean}/`) || path.startsWith(`${clean}\\`)) {
    return `~/${path.slice(clean.length + 1)}`;
  }
  return path;
}

const FINGERPRINT_PATTERN = /^dit:(\d+):([0-9a-fA-F]+)$/;

/**
 * Turns a raw render fingerprint (`dit:<bytes>:<hash>`) into a readable label for the ignored bounces list
 * when the original filename is no longer in the ledger.
 */
export function humanizeFingerprint(
  fingerprint: string,
  formatBytes: (bytes: number) => string
): string {
  const match = FINGERPRINT_PATTERN.exec(fingerprint);
  if (!match) return fingerprint;
  const size = formatBytes(Number(match[1]));
  const hash = match[2]!.slice(0, 8);
  return `Unnamed file (${size} · ${hash})`;
}
