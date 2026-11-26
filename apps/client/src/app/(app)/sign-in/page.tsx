import { SignInPrompt } from "@/components/auth/SignInPrompt";
import { nextPath } from "@/lib/next-path";
import {
  hasOAuthQuery,
  paramString,
  type RawSearchParams,
} from "@/lib/oauth-query";
import { getCachedSession } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The OAuth provider redirects an unauthenticated visitor here with a
 * signed query naming the client and the scopes it wants; once
 * `oauthProviderClient()` carries that query onto the sign-in request, the
 * provider resumes the flow on its own, so this page never has to. A member
 * who lands here with no such query has nothing to sign in for and belongs
 * on the home route instead, or on the same-origin page a `next` parameter
 * names (`/device` uses it to come back to its code).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getCachedSession();
  const sp = await searchParams;

  if (session.kind === "member" && !hasOAuthQuery(sp)) {
    redirect(nextPath(paramString(sp.next)));
  }

  return <SignInPrompt />;
}
