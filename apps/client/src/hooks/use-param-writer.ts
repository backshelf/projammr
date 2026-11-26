"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Writes query parameters in place: each entry of `changes` sets a parameter
 * (or, with `null`, drops it), the rest of the address stays, and the page
 * navigates without scrolling. `pending` is true while that navigation runs.
 */
export function useParamWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const write = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value == null) params.delete(name);
      else params.set(name, value);
    }
    const query = params.toString();
    start(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  };
  return { write, pending };
}
