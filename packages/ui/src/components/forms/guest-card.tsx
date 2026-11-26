"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCheck } from "@tabler/icons-react";
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
import { AuthSubmitResult, AuthSuccess } from "@workspace/ui/lib/auth-forms";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export const guestSchema = z.object({
  displayName: z.string("Enter a display name"),
});

const signInGuest = async (
  values: z.infer<typeof guestSchema>
): Promise<AuthSubmitResult> => {
  const { data, error } = await authClient.signIn.anonymous({});
  if (!data) {
    return { error: error?.message ?? "Could not sign in. Please try again." };
  }
  await authClient.updateUser({ name: values.displayName.trim() });
  return { token: data.token ?? null };
};

export type GuestFormProps = {
  onSuccess?: (data: AuthSuccess) => void;
};

export const GuestForm = ({ onSuccess }: GuestFormProps = {}) => {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof guestSchema>>({
    resolver: zodResolver(guestSchema),
    defaultValues: {
      displayName: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof guestSchema>) => {
    setFormError(null);

    const result = await signInGuest(data);

    if ("error" in result) {
      setFormError(result.error);
      return;
    }

    toast("Signed in", { icon: <IconCheck /> });
    onSuccess?.({ token: result.token, email: "", password: "" });
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} id={"login-form"}>
      <FieldSet>
        <FieldGroup>
          <FormController
            control={form.control}
            name={"displayName"}
            type={"input"}
            inputType={"text"}
            placeholder={"Jane Doe"}
            label={"Your name"}
          />
          {formError && (
            <Field>
              <FieldError>{formError}</FieldError>
            </Field>
          )}
          <Field>
            <Button type={"submit"} variant={"default"} disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Signing in…" : "Continue as guest"}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
};
