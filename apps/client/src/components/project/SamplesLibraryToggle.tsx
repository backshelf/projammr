"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { TOGGLE_PILL } from "@workspace/ui/components/toggle-pill";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The Library pill of the samples section: a link, so the section stays a
 * server component and the toggle's state lives in the URL. `TOGGLE_PILL`
 * comes from a client module, so its class string can only be read here.
 * `aria-pressed` belongs to buttons, so a link says its state in its name:
 * where following it goes, with the visible word inside it.
 */
export function SamplesLibraryToggle({
  href,
  pressed,
}: {
  /** Where the pill goes: the same page with the Library state flipped. */
  href: string;
  pressed: boolean;
}) {
  return (
    <AppLink
      href={href}
      className={cn(TOGGLE_PILL)}
      aria-label={pressed ? "Hide Library samples" : "Show Library samples"}
      data-pressed={pressed ? "" : undefined}
    >
      Library
    </AppLink>
  );
}
