/** The formats that keep every sample of the audio they were exported from. */
export const LOSSLESS_EXTENSIONS: readonly string[] = [
  ".wav",
  ".aiff",
  ".aif",
  ".flac",
];

/** Whether a file name (or path) ends in a lossless audio extension, in any case. */
export function isLosslessName(name: string): boolean {
  const lower = name.toLowerCase();
  return LOSSLESS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
