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
  RegisterSubmit,
} from "@workspace/ui/lib/auth-forms";
import {
  newPasswordSchema,
  type PasswordRule,
  WIDEST_PASSWORD_RULE,
} from "@workspace/ui/lib/password-rule";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

/** A registration, its password held to the instance's rule. */
export const registerSchemaFor = (rule?: PasswordRule) =>
  z.object({
    email: z.email("Enter a valid email address"),
    password: newPasswordSchema(rule),
    name: z.string().min(1, "Name is required"),
  });

type RegisterValues = z.infer<ReturnType<typeof registerSchemaFor>>;

export type RegisterFormProps = {
  /** The instance's password rule, from `GET /api/instance`; the widest any
   *  instance can set when absent. */
  passwordRule?: PasswordRule;
  onSuccess?: (data: AuthSuccess) => void;
  authClient?: AuthClient;
  // Register through something other than a Better Auth client in this page.
  submit?: RegisterSubmit;
  // Prefill the email (e.g. the address a project invite was sent to), and
  // optionally make it read-only when the flow requires that exact address.
  defaultEmail?: string;
  lockEmail?: boolean;
};

const signUpWithClient = async (
  client: AuthClient,
  values: RegisterValues
): Promise<AuthSubmitResult> => {
  const { data, error } = await client.signUp.email(values);
  return data
    ? { token: data.token ?? null }
    : {
        error:
          error?.message ?? "Could not create your account. Please try again.",
      };
};

export const RegisterForm = ({
  onSuccess,
  authClient: client = authClient,
  submit,
  defaultEmail,
  lockEmail,
  passwordRule = WIDEST_PASSWORD_RULE,
}: RegisterFormProps) => {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchemaFor(passwordRule)),
    defaultValues: {
      email: defaultEmail ?? "",
      password: "",
      name: "",
    },
  });

  const onSubmit = async (data: RegisterValues) => {
    setFormError(null);

    const result = submit
      ? await submit(data)
      : await signUpWithClient(client, data);

    if ("error" in result) {
      setFormError(result.error);
      return;
    }

    toast("Successfully registered!", { icon: <IconCheck /> });
    onSuccess?.({
      token: result.token,
      email: data.email,
      password: data.password,
    });
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} id={"register-form"}>
      <FieldSet>
        <FieldGroup>
          <FormController
            control={form.control}
            name={"name"}
            type={"input"}
            inputType={"text"}
            label={"Name"}
          />
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
            description={`At least ${passwordRule.passwordMin} characters`}
          />
          {formError && (
            <Field>
              <FieldError>{formError}</FieldError>
            </Field>
          )}
          <Field>
            <Button type={"submit"} variant={"default"} disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
};
