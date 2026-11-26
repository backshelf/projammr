import { pluralizeCount } from "@workspace/session-diff/format";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The small pill button that sits in the audio block's meta row — the comments
 * trigger, and the two plain actions beside it. Outlined rather than filled, so
 * a row of them stays quieter than the waveform above.
 */
export const AUDIO_PILL = cn(
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-rule-strong",
  "bg-transparent px-2 py-[0.1875rem] text-micro text-ink-soft motion-ink coarse:min-h-11",
  "hover:border-ink-faint hover:text-ink",
  "aria-expanded:border-ink-faint aria-expanded:text-ink",
  "[&_svg]:size-[0.8125rem]"
);

/** The comments pill's text, which is also its accessible name: it names the
 *  version, so the thread is never mistaken for the track's own comments. */
export const versionCommentsLabel = (
  count: number,
  version: number,
  resolvedCount = 0
) => {
  if (count === 0) return `Comments on v${version}`;
  if (isAllResolved(count, resolvedCount))
    return `All ${count} resolved on v${version}`;
  const total = `${pluralizeCount(count, "comment")} on v${version}`;
  return resolvedCount > 0 ? `${total} · ${resolvedCount} resolved` : total;
};

/** Whether every root comment is resolved, with at least one to resolve. */
export const isAllResolved = (count: number, resolvedCount: number) =>
  count > 0 && resolvedCount >= count;

/** The version selector: a chevron, a badge and the filename, in mono. The
 *  chevron rotates 90° when the menu opens, matching the section heads. The
 *  button keeps its automatic minimum width, so a crowded line can never
 *  squeeze it under its own badge; the filename span carries the `min-w-0
 *  truncate` that lets it give way instead. */
export const VERSION_TRIGGER = cn(
  "inline-flex cursor-pointer items-center gap-[0.4375rem] border-none bg-transparent p-0 coarse:min-h-11",
  "font-mono text-micro text-ink-soft hover:text-ink"
);

export const VERSION_CHEVRON = cn(
  "size-3.5 shrink-0 text-ink-faint motion-move",
  "group-aria-expanded:rotate-90"
);
