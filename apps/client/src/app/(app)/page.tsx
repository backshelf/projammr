import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { SignInPrompt } from "@/components/auth/SignInPrompt";
import { cachedBrand } from "@/lib/brand";
import { landingHref } from "@/lib/landing";
import { cachedMyProjects } from "@/lib/server-data";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { getCachedSession, isSignedOut } from "@/lib/session";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getCachedSession();
  return { title: isSignedOut(session) ? "Sign in" : "Projects" };
}

export default async function Page() {
  const session = await getCachedSession();

  // A session the API could not answer for is not a signed-out one: offering
  // the sign-in form here would invite a reader to sign in again over the same
  // failing API, and read as having been logged out.
  if (session.kind === "unavailable") {
    const brand = await cachedBrand();
    return (
      <CenteredPageShell
        title={`Can't reach ${brand.name}`}
        body="The server didn't answer. Your session is still there — try again in a moment."
      />
    );
  }

  if (isSignedOut(session)) {
    return <SignInPrompt />;
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("currentProject")?.value;
  const cookieProjectId = cookieValue ? Number(cookieValue) : null;

  const [projects, settings] = await Promise.all([
    cachedMyProjects(),
    cachedEffectiveSettings(),
  ]);

  redirect(
    landingHref({
      landing: settings.values["navigation.landing"],
      defaultProject: settings.values["navigation.defaultProject"],
      cookieProjectId,
      projects,
    })
  );
}
