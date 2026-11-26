import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { ConsentForm } from "@/components/auth/ConsentForm";
import {
  paramString,
  searchParamsToQueryString,
  type RawSearchParams,
} from "@/lib/oauth-query";
import { getCachedSession, isSignedOut } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Allow access" };

/**
 * The OAuth provider sends a signed-in visitor here with `client_id`, `scope`
 * and, when the client asked for identity claims, `claims`. A signed-out
 * visitor has nothing to consent as, so they go through `/sign-in` first,
 * carrying the same query back for the provider to resume once they are.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getCachedSession();
  const sp = await searchParams;

  if (isSignedOut(session)) {
    const query = searchParamsToQueryString(sp);
    redirect(query ? `/sign-in?${query}` : "/sign-in");
  }

  return (
    <CenteredPageShell
      title="Allow access"
      body="Choose what this application can do with your projects."
    >
      <ConsentForm
        clientId={paramString(sp.client_id) ?? ""}
        scope={paramString(sp.scope) ?? ""}
        claims={paramString(sp.claims)}
      />
    </CenteredPageShell>
  );
}
