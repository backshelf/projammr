/**
 * A sample's identity is the path string its session stored, written on
 * whichever machine saved the set, so either separator may appear. The
 * filename and the folder are derived from it for display only.
 */

/** The last path segment: what a producer calls the sample. */
export function sampleFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/** Everything before the last segment; empty for a bare filename. */
export function sampleFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? "" : path.slice(0, cut);
}
