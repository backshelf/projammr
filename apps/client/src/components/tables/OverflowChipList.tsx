"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Renders inline chips or links on a single non-wrapping line so table cells
 * stay within `--table-row-h`. Items beyond `maxVisible` collapse behind a
 * `+N` pill that opens a popover with the full list.
 */
export function OverflowChipList<T>({
  items,
  maxVisible = 2,
  getKey,
  renderItem,
  overflowLabel = "items",
  trailing,
  className,
  listClassName,
}: {
  items: readonly T[];
  /** Maximum items drawn inline before collapsing the rest behind `+N`. */
  maxVisible?: number;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Plural noun for the `+N` pill's accessible name ("Show 3 more labels"). */
  overflowLabel?: string;
  /** Optional control kept visible after the strip (e.g. a "+" picker trigger). */
  trailing?: ReactNode;
  className?: string;
  /** Extra classes for the inline item strip. */
  listClassName?: string;
}) {
  const visible = items.slice(0, maxVisible);
  const hiddenCount = items.length - visible.length;

  return (
    <div
      className={cn("flex min-w-0 flex-nowrap items-center gap-1", className)}
    >
      {visible.length > 0 && (
        <div
          className={cn(
            "flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden",
            listClassName
          )}
        >
          {visible.map((item, index) => (
            <span
              key={getKey(item, index)}
              className="flex min-w-0 items-center"
            >
              {renderItem(item, index)}
            </span>
          ))}
        </div>
      )}
      {hiddenCount > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Show ${hiddenCount} more ${overflowLabel}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-rule bg-paper-sunk px-1.5 font-mono text-micro text-ink-soft tabular-nums motion-ink hover:border-rule-strong hover:text-ink"
            >
              +{hiddenCount}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-72 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {items.map((item, index) => (
                <span
                  key={getKey(item, index)}
                  className="inline-flex items-center"
                >
                  {renderItem(item, index)}
                </span>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {trailing}
    </div>
  );
}
