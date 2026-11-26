"use client";

import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useOffline } from "next/offline";

/**
 * Says the connection is gone, in normal flow above the app so it never covers
 * a masthead. Next holds navigations and server actions until the connection
 * returns rather than failing them, which is what "wait" means here.
 */
export function OfflineBanner() {
  const isOffline = useOffline();

  return isOffline ? (
    <div
      role="status"
      className={cn(
        LABEL,
        "border-b border-rule bg-paper-sunk px-(--gutter) py-2 text-center text-ink-soft"
      )}
    >
      Offline · changes wait for a connection
    </div>
  ) : null;
}
