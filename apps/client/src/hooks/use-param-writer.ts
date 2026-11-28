"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

type ParamWriterOptions = {
  /**
   * Update the URL via `window.history.replaceState` instead of
   * `router.replace`. Next.js syncs `useSearchParams()` immediately without
   * triggering a server RSC re-render — use this when only client components
   * read the parameters being written.
   */
  shallow?: boolean;
};

/**
 * Writes query parameters in place: each entry of `changes` sets a parameter
 * (or, with `null`, drops it), the rest of the address stays, and the page
 * navigates without scrolling. `pending` is true while a server navigation runs.
 */
export function useParamWriter({ shallow = false }: ParamWriterOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const write = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [name, value] of Object.entries(changes)) {
        if (value == null) params.delete(name);
        else params.set(name, value);
      }
      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      if (shallow) {
        window.history.replaceState(null, "", nextUrl);
        return;
      }
      start(() => {
        router.replace(nextUrl, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams, shallow]
  );
  return { write, pending };
}
