import { getInstance } from "@/actions/instance";
import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reset password" };

/**
 * Reachable in both mail modes: an admin-issued link (`POST
 * /admin/users/:id/reset-link`) and a mailed one both land here with the
 * token as a query parameter, never in the path.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, instance] = await Promise.all([
    searchParams,
    getInstance(),
  ]);

  return (
    <CenteredPageShell
      title="Reset your password"
      body="Choose a new password for your account."
    >
      <ResetPasswordForm
        token={token ?? null}
        passwordRule={isActionError(instance) ? undefined : instance}
      />
    </CenteredPageShell>
  );
}
