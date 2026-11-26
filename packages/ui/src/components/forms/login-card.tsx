"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCheck } from "@tabler/icons-react";
import { AuthClient, authClient } from "@workspace/api/lib/auth-client";
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
  AuthSubmitResult,
  AuthSuccess,
  LoginSubmit,
} from "@workspace/ui/lib/auth-forms";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

/** Password recovery, offered under the password field: a link where the
 *  instance can mail one, or a line naming who can hand one out where it
 *  can't. Absent renders neither — the invite and share sign-in flows, which
 *  pass no instance state at all. */
export type LoginRecovery =
  { kind: "link"; href: string } | { kind: "message"; text: string };

export type LoginFormProps = {
  onSuccess?: (data: AuthSuccess) => void;
  authClient?: AuthClient;
  // Sign in through something other than a Better Auth client in this page.
  submit?: LoginSubmit;
  // Prefill the email (e.g. the address a project invite was sent to), and
  // optionally make it read-only when the flow requires that exact address.
  defaultEmail?: string;
  lockEmail?: boolean;
  recovery?: LoginRecovery;
};

const signInWithClient = async (
  client: AuthClient,
  values: z.infer<typeof loginSchema>
): Promise<AuthSubmitResult> => {
  const { data, error } = await client.signIn.email(values);
  return data
    ? { token: data.token ?? null }
    : { error: error?.message ?? "Could not sign in. Please try again." };
};

export const LoginForm = ({
  onSuccess,
  authClient: client = authClient,
  submit,
  defaultEmail,
  lockEmail,
  recovery,
}: LoginFormProps) => {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: defaultEmail ?? "",
      password: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setFormError(null);

    const result = submit
      ? await submit(data)
      : await signInWithClient(client, data);

    if ("error" in result) {
      setFormError(result.error);
      return;
    }

    toast("Signed in", { icon: <IconCheck /> });
    onSuccess?.({
      token: result.token,
      email: data.email,
      password: data.password,
    });
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} id={"login-form"}>
      <FieldSet>
        <FieldGroup>
          <FormController
            control={form.control}
            name={"email"}
            type={"input"}
            inputType={"email"}
            placeholder={"you@example.com"}
            label={"Email"}
            readOnly={lockEmail}
            description={
              lockEmail ? "Your invite was sent to this address." : undefined
            }
          />
          <FormController
            control={form.control}
            name={"password"}
            type={"input"}
            inputType={"password"}
            label={"Password"}
          />
          {recovery && (
            <p className={"text-right text-micro text-ink-soft"}>
              {recovery.kind === "link" ? (
                <a href={recovery.href} className={"motion-ink hover:text-ink"}>
                  Forgot password?
                </a>
              ) : (
                recovery.text
              )}
            </p>
          )}
          {formError && (
            <Field>
              <FieldError>{formError}</FieldError>
            </Field>
          )}
          <Field>
            <Button type={"submit"} variant={"default"} disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
};
