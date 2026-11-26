/** The three kinds of line a hunk holds, in the order its header counts them. */
export const HUNK_SIGNS = ["+", "~", "−"] as const;

export type HunkSign = (typeof HUNK_SIGNS)[number];

/** The colour of a gutter mark, in a line and in the hunk header's counts. */
export const SIGN_MARK: Record<HunkSign, string> = {
  "+": "text-art",
  "~": "text-ink-soft",
  "−": "text-ink-faint",
};
