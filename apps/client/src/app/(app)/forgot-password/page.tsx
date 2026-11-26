import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { cachedInstance } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Forgot password" };

/**
 * Email-mode only: a mailless instance has nowhere to send a reset link, and
 * `POST /auth/request-password-reset` answers 404 there. The sign-in card is
 * where a caller on that instance is told to ask the admin instead.
 */
export default async function ForgotPasswordPage() {
  const instance = await cachedInstance();

  if (!isActionError(instance) && !instance.emailEnabled) {
    redirect("/sign-in");
  }

  return (
    <CenteredPageShell
      title="Reset your password"
      body="Enter the email address on your account and we will send a link to reset your password."
    >
      <ForgotPasswordForm />
    </CenteredPageShell>
  );
}
