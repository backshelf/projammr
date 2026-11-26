import { cn } from "@workspace/ui/lib/utils";
import React from "react";

/**
 * A single rail value. Renders "Not set" in a quiet italic when empty, and
 * takes the same quiet italic for a value that is not final yet, so a figure
 * still being worked out never reads as the answer.
 */
export const MetadataItem = (
  props: React.PropsWithChildren<{
    variant?: "default" | "subtle";
    pending?: boolean;
  }>
) => {
  const isEmpty = props.children == null || props.children === "";
  const isQuiet = isEmpty || props.pending === true;

  return (
    <div
      className={cn(
        "line-clamp-1 text-small [overflow-wrap:anywhere] text-ink",
        isQuiet && "text-ink-soft italic",
        props.variant === "subtle" && !isQuiet && "text-ink-soft"
      )}
    >
      {isEmpty ? "Not set" : props.children}
    </div>
  );
};
