import type { JSX } from "react";

/**
 * The one-line notices the app holds until they pass. Information, never an alert: soft ink behind a hairline,
 * and nothing rendered (no gap in the stack) while there are none.
 */
export function Notices({
  notices,
}: {
  notices: string[];
}): JSX.Element | null {
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <p
          key={notice}
          role="status"
          className="border-l border-rule-strong pl-3 text-small text-pretty text-ink-soft"
        >
          {notice}
        </p>
      ))}
    </div>
  );
}
