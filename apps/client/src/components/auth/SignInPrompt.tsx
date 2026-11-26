import { AuthWrapper } from "@/components/auth/AuthWrapper";
import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { cachedBrand } from "@/lib/brand";
import { cachedInstance } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The sign-in card shown to a signed-out visitor: the home route's
 * signed-out branch, and `/sign-in`'s entire content. Kept as one component
 * so the two never drift apart.
 */
export async function SignInPrompt() {
  const [instance, brand] = await Promise.all([
    cachedInstance(),
    cachedBrand(),
  ]);

  return (
    <CenteredPageShell
      title={brand.name}
      body="Keep your projects, collections, tracks and sessions in one place."
    >
      <AuthWrapper instance={isActionError(instance) ? undefined : instance} />
    </CenteredPageShell>
  );
}
