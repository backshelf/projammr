"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@workspace/api/lib/auth-client";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldSet,
} from "@workspace/ui/components/field";
import { FormController } from "@workspace/ui/components/forms/form-controller";
import { Spinner } from "@workspace/ui/components/spinner";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address"),
});

/**
 * Requests a mailed reset link. Better Auth answers the same way whether or
 * not the address has an account — the confirmation copy below says so
 * rather than either promising or denying that one exists.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async ({ email }: z.infer<typeof forgotPasswordSchema>) => {
    setFormError(null);

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setFormError(
        error.message ?? "Could not send a reset link. Please try again."
      );
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <p className={"w-full max-w-sm text-body text-ink-soft"}>
        If that address has an account, check your email for a link to reset its
        password.
      </p>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={"w-full max-w-sm"}>
      <FieldSet>
        <FieldGroup>
          <FormController
            control={form.control}
            name={"email"}
            type={"input"}
            inputType={"email"}
            placeholder={"you@example.com"}
            label={"Email"}
          />
          {formError && (
            <Field>
              <FieldError>{formError}</FieldError>
            </Field>
          )}
          <Field>
            <Button type={"submit"} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
            </Button>
          </Field>
          <Field>
            <AppLink
              href={"/sign-in"}
              className={"text-micro text-ink-soft hover:text-ink"}
            >
              Back to sign in
            </AppLink>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
