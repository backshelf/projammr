import type { JSX } from "react";
import { cn } from "@workspace/ui/lib/utils";

import type { StatusLine } from "./status-model";

/** The lines as quiet notes beside a hairline, a problem in the danger ink; nothing, with no gap, when there are none. */
export function StatusLines({
  lines,
}: {
  lines: readonly StatusLine[];
}): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line) => (
        <p
          key={line.key}
          role={line.tone === "problem" ? "alert" : "status"}
          className={cn(
            "border-l pl-3 text-small text-pretty",
            line.tone === "problem"
              ? "border-danger text-danger"
              : "border-rule-strong text-ink-soft"
          )}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
