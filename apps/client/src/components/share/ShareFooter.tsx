"use client";

import { BrandMark } from "@/components/brand/BrandMark";
import { useShareRoom } from "@/components/share/ShareRoom";
import { useBrand } from "@/lib/brand-context";
import { isDefaultBrand } from "@/lib/brand-defaults";
import { SITE } from "@workspace/ui/lib/site";
import { cn } from "@workspace/ui/lib/utils";

/** Where the share came from, at the foot of the page. The wordmark is a plain
 *  anchor: the reader holds no account here, so it is a way out to the project
 *  rather than a route into the app. */
export function ShareFooter() {
  const { artwork } = useShareRoom();
  const brand = useBrand();

  return (
    <footer>
      <p className={cn("text-micro text-ink-soft", artwork && "on-art-soft")}>
        Shared with{" "}
        {isDefaultBrand(brand) ? (
          <a
            href={SITE.repository}
            className={
              "inline-flex items-center gap-1 align-middle hover:text-ink"
            }
          >
            <BrandMark />
            {brand.name}
          </a>
        ) : (
          <span className={"inline-flex items-center gap-1 align-middle"}>
            <BrandMark />
            {brand.name}
          </span>
        )}
        , a listening room for works in progress.
      </p>
    </footer>
  );
}
