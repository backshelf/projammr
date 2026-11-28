"use client";

import { cn } from "@workspace/ui/lib/utils";
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/** Carries the link's pending state into the DOM, where the anchor's style reads it with `:has()`. */
function PendingMark() {
  const { pending } = useLinkStatus();
  return <span hidden data-pending={pending ? "" : undefined} />;
}

/**
 * The one link component the client uses. A navigation that is still pending
 * after 100ms fades the link's own content to the soft ink and pulses it
 * gently until the page lands; a fast navigation shows nothing. Accepts
 * exactly `next/link`'s props and forwards every one of them untouched.
 */
export function AppLink({
  children,
  className,
  prefetch = false,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      prefetch={prefetch}
      className={cn("link-pending", className)}
    >
      {children}
      <PendingMark />
    </Link>
  );
}
