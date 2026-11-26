"use client";

import { AppLink } from "@/components/navigation/AppLink";
import type { StockItem } from "@/lib/inventory-web";
import { TOGGLE_PILL } from "@workspace/ui/components/toggle-pill";
import { pluralizeCount } from "@workspace/session-diff/format";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The stock chain under the web: the items so many of the page's sets carry
 * that they would carry most of the drawing's ink, most used first, each a
 * chip linking to its row. The control at the end puts them into the web or
 * takes them out again (`?stock=1`); the chips stay either way.
 */
export function StockChainStrip({
  items,
  shown,
  toggleHref,
}: {
  items: StockItem[];
  /** Whether the web draws them. */
  shown: boolean;
  /** The same view with the stock chain the other way. */
  toggleHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={cn(LABEL, "mr-1 text-ink-soft")}>Stock chain</span>
      {items.map((item) =>
        item.href ? (
          <AppLink
            key={item.id}
            href={item.href}
            scroll={false}
            className={cn(TOGGLE_PILL, "tabular-nums")}
          >
            {item.label} · {pluralizeCount(item.sets, "set")}
          </AppLink>
        ) : (
          <span key={item.id} className={cn(TOGGLE_PILL, "tabular-nums")}>
            {item.label} · {pluralizeCount(item.sets, "set")}
          </span>
        )
      )}
      <AppLink
        href={toggleHref}
        scroll={false}
        className="inline-flex items-center px-1 text-micro text-ink-soft underline-offset-2 hover:text-ink hover:underline focus-visible:underline coarse:min-h-11"
      >
        {shown ? "Hide stock chain" : "Show stock chain"}
      </AppLink>
    </div>
  );
}
