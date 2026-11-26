import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { cachedBrand } from "@/lib/brand";
import { Button } from "@workspace/ui/components/button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * The document the service worker serves when a page is asked for with no
 * connection. It sits outside `(app)` so it carries no session dependency of
 * its own and can be precached on install.
 *
 * "Try again" is a bare link to the document's own URL — the page that was
 * asked for, since the worker answers in its place — so it works from the
 * precached HTML alone, before or without this route's own scripts. An
 * offline reader has no live instance read either, so this precached page
 * carries the brand the instance had when the service worker installed.
 */
export default async function Offline() {
  const brand = await cachedBrand();
  return (
    <CenteredPageShell
      title="You're offline"
      body={`${brand.name} needs a connection to load this page. Your music and notes are safe on the server.`}
    >
      <Button variant="ghost" asChild>
        <a href="">Try again</a>
      </Button>
    </CenteredPageShell>
  );
}
