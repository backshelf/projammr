"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { Button } from "@workspace/ui/components/button";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { usePathname, useSearchParams } from "next/navigation";

export function PageLinks({
  page,
  pageSize,
  rowCount,
}: {
  page: number;
  pageSize: number;
  rowCount: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  if (pageCount <= 1) {
    return null;
  }

  const hrefForPage = (targetPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(targetPage));
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <span className="text-micro text-ink-soft tabular-nums">
        Page {page} of {pageCount}
      </span>
      {page > 1 ? (
        <Button variant="outline" size="sm" asChild>
          <AppLink href={hrefForPage(page - 1)}>
            <IconChevronLeft size={14} />
            Prev
          </AppLink>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          <IconChevronLeft size={14} />
          Prev
        </Button>
      )}
      {page < pageCount ? (
        <Button variant="outline" size="sm" asChild>
          <AppLink href={hrefForPage(page + 1)}>
            Next
            <IconChevronRight size={14} />
          </AppLink>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Next
          <IconChevronRight size={14} />
        </Button>
      )}
    </div>
  );
}
