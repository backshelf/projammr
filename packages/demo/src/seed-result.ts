/**
 * The server ids a seed produced, keyed the way the catalogue names things.
 * The seed writes it beside its inputs; the screenshot capture reads it to
 * turn a route's catalogue keys into ids. It imports nothing, so a consumer
 * of the type pulls in no seed code.
 */
export interface SeedResult {
  api: string;
  accounts: Record<string, { email: string; password: string }>;
  projects: Record<
    string,
    {
      id: number;
      tracks: Record<string, number>;
      trackAudios: Record<string, number[]>;
      collections: Record<string, number>;
      sessions: Record<string, number>;
      /** Each track's lyrics note. */
      lyrics: Record<string, number>;
      /** Each pending invite's token, by the address it was sent to. */
      invites: Record<string, string>;
    }
  >;
  shareLinks: { project: string; entity: string; token: string }[];
  /** The notebook notes, in catalogue order. */
  notes: number[];
}
