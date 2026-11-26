"use client";
import { keyedByContent } from "@workspace/ui/lib/keyed";

import type { Crumb } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

import { useMastheadScroll } from "@/components/motion/masthead-scroll";
import { AppLink } from "@/components/navigation/AppLink";

export const Breadcrumbs = ({ crumbs }: { crumbs: Crumb[] }) => {
  const trail = keyedByContent(crumbs, (crumb) => crumb.href).flatMap(
    ({ key, item: crumb }, index) => [
      ...(index > 0
        ? [<BreadcrumbSeparator key={`${key}-sep`}>/</BreadcrumbSeparator>]
        : []),
      <BreadcrumbItem key={key}>
        <BreadcrumbLink asChild>
          <AppLink
            href={crumb.href}
            className="coarse:inline-flex coarse:min-h-11 coarse:items-center"
          >
            {crumb.label.toUpperCase()}
          </AppLink>
        </BreadcrumbLink>
      </BreadcrumbItem>,
    ]
  );

  return (
    <Breadcrumb
      asChild
      className={cn(
        // The trail takes its left edge from the head it sits in, which is the
        // title's, rather than centring a measure of its own.
        "mb-3 flex flex-wrap items-center",
        "gap-[0.4375rem] text-micro text-ink"
      )}
    >
      <m.nav {...useArrival("crumbs")} style={useMastheadScroll("crumbs")}>
        <BreadcrumbList>{trail}</BreadcrumbList>
      </m.nav>
    </Breadcrumb>
  );
};
