import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { DeviceApproval } from "@/components/auth/DeviceApproval";
import { signInUrlFor } from "@/lib/next-path";
import {
  paramString,
  searchParamsToQueryString,
  type RawSearchParams,
} from "@/lib/oauth-query";
import { getCachedSession, isSignedOut } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Connect dit" };

/**
 * `dit login` opens this page with the code it is showing in the terminal as
 * `user_code`. A signed-out visitor has nothing to approve it as, so they go
 * through `/sign-in` first, which sends them back here with the query intact.
 */
export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getCachedSession();
  const sp = await searchParams;

  if (isSignedOut(session)) {
    const query = searchParamsToQueryString(sp);
    redirect(signInUrlFor(query ? `/device?${query}` : "/device"));
  }

  return (
    <CenteredPageShell title="Connect dit">
      <DeviceApproval initialCode={paramString(sp.user_code)} />
    </CenteredPageShell>
  );
}
