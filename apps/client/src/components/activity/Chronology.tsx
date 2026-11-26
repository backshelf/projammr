import type { Formatters } from "@workspace/ui/lib/formatters";
import type { ReactNode } from "react";

/**
 * A chronology rather than a conversation: one line per event down a hairline
 * on the left, no avatars or bullets, and the detail of what changed kept.
 */
export function Chronology({ children }: { children: ReactNode }) {
  return (
    <ul className="m-0 list-none border-l border-rule p-0 pl-4">{children}</ul>
  );
}

/**
 * One event: what happened, with any detail under it, and when, relative, at
 * the right. `format` is the viewer's formatter set: `cachedFormatters()` in a
 * server render, `useFormat()` in a client one.
 */
export function ChronologyEntry({
  at,
  format,
  children,
}: {
  at: string;
  format: Formatters;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 py-[0.4375rem] text-micro text-ink-soft">
      <span className="min-w-0 text-ink">{children}</span>
      <time
        dateTime={at}
        title={format.dateTime(at)}
        className="ml-auto shrink-0 text-ink-soft tabular-nums"
      >
        {format.relative(at)}
      </time>
    </li>
  );
}
