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
import {
  newPasswordSchema,
  type PasswordRule,
  WIDEST_PASSWORD_RULE,
} from "@workspace/ui/lib/password-rule";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const resetPasswordSchemaFor = (rule?: PasswordRule) =>
  z.object({ newPassword: newPasswordSchema(rule) });

type ResetPasswordValues = z.infer<ReturnType<typeof resetPasswordSchemaFor>>;

/**
 * Consumes the token from a mailed or admin-issued link (`?token=` on this
 * page) to set a new password, held to the instance's password rule. A
 * missing token means the link was mistyped or already used to mint the page
 * some other way — there is nothing to submit, so the form never renders for
 * one.
 */
export function ResetPasswordForm({
  token,
  passwordRule = WIDEST_PASSWORD_RULE,
}: {
  token: string | null;
  /** From `GET /api/instance`; the widest rule any instance can set when absent. */
  passwordRule?: PasswordRule;
}) {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchemaFor(passwordRule)),
    defaultValues: { newPassword: "" },
  });

  const onSubmit = async ({ newPassword }: ResetPasswordValues) => {
    if (!token) return;
    setFormError(null);

    const { error } = await authClient.resetPassword({
      newPassword,
      token,
    });

    if (error) {
      setFormError(error.message ?? "This link is invalid or has expired.");
      return;
    }

    setDone(true);
  };

  if (!token) {
    return (
      <div className={"flex w-full max-w-sm flex-col gap-4 text-center"}>
        <p className={"text-body text-ink-soft"}>
          This link is invalid or has expired.
        </p>
        <Button asChild>
          <AppLink href={"/forgot-password"}>Send a new link</AppLink>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className={"flex w-full max-w-sm flex-col gap-4 text-center"}>
        <p className={"text-body text-ink-soft"}>
          Your password has been reset.
        </p>
        <Button asChild>
          <AppLink href={"/sign-in"}>Sign in</AppLink>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={"w-full max-w-sm"}>
      <FieldSet>
        <FieldGroup>
          <FormController
            control={form.control}
            name={"newPassword"}
            type={"input"}
            inputType={"password"}
            label={"New password"}
            description={`At least ${passwordRule.passwordMin} characters`}
          />
          {formError && (
            <Field>
              <FieldError>{formError}</FieldError>
            </Field>
          )}
          <Field>
            <Button type={"submit"} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              {form.formState.isSubmitting ? "Resetting…" : "Reset password"}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
