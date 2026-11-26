"use client";

import { FormLayout, FormRow } from "@/components/forms/components/FormLayout";
import { storageLimitFailure, storageLimitMessage } from "@/lib/storage-limit";
import { PAGE } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { uploadImage } from "@/components/uploads/upload-client";
import { settingsHref } from "@/lib/settings/href";
import { mediaProxyUrl } from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  IconLoader2,
  IconPencil,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { AppLink } from "@/components/navigation/AppLink";
import { ProfileHeatmap } from "@/components/work-heatmap/ProfileHeatmap";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { authClient } from "@workspace/api/lib/auth-client";
import { browserApi } from "@/lib/browser-api";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import type { DeletionPlan, DeletionPlanProject, Me } from "@workspace/api/api";
import {
  describeDevice,
  revokeDeviceSession,
  sortByLastActive,
  type DeviceSession,
} from "./devices";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { FormController } from "@workspace/ui/components/forms/form-controller";
import { Input } from "@workspace/ui/components/input";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { IMAGE_ACCEPT } from "@workspace/api/lib/upload";
import { useFileDrop } from "@workspace/ui/hooks/use-file-drop";
import {
  newPasswordSchema,
  type PasswordRule,
} from "@workspace/ui/lib/password-rule";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

// Minimal shape we actually use from the Better Auth session user
type User = {
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

function resolveImageUrl(path?: string | null): string | undefined {
  return mediaProxyUrl(path) || undefined;
}

// --- Avatar uploader ---

function AvatarUploader({ currentImage }: { currentImage?: string | null }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadImage(file);
      if (isActionError(result)) {
        const limit = storageLimitFailure(result);
        toast.error(
          limit
            ? storageLimitMessage(limit)
            : `Failed to upload image: ${result.error}`
        );
        return;
      }

      // The API returns the stored key; the profile stores the public path the
      // media proxy serves it from.
      const imageUrl = mediaProxyUrl(result.assetPath);
      const { data, error } = await authClient.updateUser({ image: imageUrl });

      if (error || !data?.status) {
        toast.error(error?.message ?? "Failed to update profile image");
        return;
      }
      toast.success("Profile image updated");
      router.refresh();
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    const { data, error } = await authClient.updateUser({ image: null });
    if (error || !data?.status) {
      toast.error(error?.message ?? "Failed to remove profile image");
      return;
    }
    toast.success("Profile image removed");
    router.refresh();
  };

  const { rootProps, inputProps, open } = useFileDrop({
    onFiles: ([file]) => file && void handleUpload(file),
    disabled: uploading,
  });

  const displayUrl = resolveImageUrl(currentImage);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        {...rootProps}
        aria-label="Upload a new profile photo"
        className="group relative block cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-none"
      >
        <Avatar size="lg" className="size-20">
          {displayUrl ? <AvatarImage src={displayUrl} alt="avatar" /> : null}
          <AvatarFallback>
            <IconUser size={24} />
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--ink)_50%,transparent)] text-paper",
            "fine:opacity-0 fine:motion-reveal fine:group-focus-within:opacity-100 fine:group-hover:opacity-100 fine:group-data-[drag]:opacity-100 coarse:hidden",
            uploading && "opacity-100 coarse:flex coarse:opacity-100"
          )}
        >
          {uploading ? (
            <IconLoader2 className="size-6 animate-spin" />
          ) : (
            <IconUser size={22} />
          )}
        </span>
        {!uploading && (
          <span
            className={cn(
              "absolute right-0 bottom-0 hidden items-center justify-center rounded-full",
              "bg-[color-mix(in_oklab,var(--ink)_55%,transparent)] text-paper",
              "size-6 coarse:flex"
            )}
          >
            <IconPencil size={13} />
          </span>
        )}
        <input {...inputProps} accept={IMAGE_ACCEPT} />
      </div>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-small"
        onClick={open}
        disabled={uploading}
      >
        Change photo
      </Button>

      {currentImage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-small text-danger"
          onClick={handleRemove}
          disabled={uploading}
        >
          <IconTrash className="size-3" /> Remove
        </Button>
      ) : null}
    </div>
  );
}

function FieldDescriptionText({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 text-body text-ink-soft">{children}</p>;
}

// --- Section submit button ---

function SaveButton({ form, disabled }: { form: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" size="sm" form={form} disabled={disabled}>
        Save
      </Button>
    </div>
  );
}

// --- Profile section ---

const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

function ProfileSection({ user }: { user: User }) {
  const router = useRouter();

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name,
    },
  });

  const onSubmit = async (values: z.infer<typeof profileSchema>) => {
    const { data, error } = await authClient.updateUser({
      name: values.name,
    });

    if (data) {
      toast.success("Profile updated");
      router.refresh();
    }

    if (error) {
      toast.error(error.message ?? "Failed to update profile");
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      id="profile-form"
      className="flex flex-col gap-4"
    >
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
        <FieldDescriptionText>
          Your name and photo, shown across the app.
        </FieldDescriptionText>
        <div className="flex flex-col gap-6 sm:flex-row">
          <AvatarUploader currentImage={user.image} />
          <div className="flex-1">
            <FieldGroup>
              <FormController
                control={form.control}
                name="name"
                label="Name"
                placeholder="Jane Doe"
              />
            </FieldGroup>
          </div>
        </div>
      </FieldSet>
      <SaveButton form="profile-form" disabled={form.formState.isSubmitting} />
    </form>
  );
}

// --- Change email section ---

/**
 * `currentPassword` stays in the schema either way, so `useForm`'s inferred
 * type does not change shape between the two instances, and is only
 * required — via `superRefine` rather than a second schema — on an instance
 * with no mail transport, where `PATCH /me/email` is the change-email path
 * and needs one. With mail, Better Auth's own `changeEmail` needs no
 * password: the confirmation link at the current address is what proves it.
 */
const changeEmailSchema = (emailEnabled: boolean) =>
  z
    .object({
      newEmail: z.email(),
      currentPassword: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (!emailEnabled && !data.currentPassword) {
        ctx.addIssue({
          code: "custom",
          path: ["currentPassword"],
          message: "Current password is required",
        });
      }
    });

function ChangeEmailSection({
  user,
  emailEnabled,
}: {
  user: User;
  emailEnabled: boolean;
}) {
  const router = useRouter();

  const form = useForm<z.infer<ReturnType<typeof changeEmailSchema>>>({
    resolver: zodResolver(changeEmailSchema(emailEnabled)),
    defaultValues: {
      newEmail: "",
      currentPassword: "",
    },
  });

  const onSubmit = async (
    data: z.infer<ReturnType<typeof changeEmailSchema>>
  ) => {
    if (emailEnabled) {
      const { data: result, error } = await authClient.changeEmail({
        newEmail: data.newEmail,
      });

      if (result?.status) {
        toast.success(
          "Email change requested. Check your new inbox to confirm the change."
        );
        form.reset({ newEmail: "", currentPassword: "" });
        router.refresh();
        return;
      }

      if (error) {
        toast.error(error.message ?? "Failed to change email");
      }
      return;
    }

    const result = await toActionResult<Me>(
      await browserApi.PATCH("/api/me/email", {
        body: {
          newEmail: data.newEmail,
          currentPassword: data.currentPassword ?? "",
        },
      }),
      "Failed to change email"
    );

    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }

    toast.success("Email changed");
    form.reset({ newEmail: "", currentPassword: "" });
    router.refresh();
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      id="change-email-form"
      className="flex flex-col gap-4"
    >
      <FieldSet>
        <FieldLegend>Email</FieldLegend>
        <FieldDescriptionText>
          Currently {user.email}
          {user.emailVerified ? "" : " (unverified)"}.
        </FieldDescriptionText>
        <FieldGroup>
          <FormController
            control={form.control}
            name="newEmail"
            label="New email"
            type="input"
            inputType="email"
            placeholder="jane@example.com"
          />
          {!emailEnabled && (
            <FormController
              control={form.control}
              name="currentPassword"
              label="Current password"
              type="input"
              inputType="password"
            />
          )}
        </FieldGroup>
      </FieldSet>
      <SaveButton
        form="change-email-form"
        disabled={form.formState.isSubmitting}
      />
    </form>
  );
}

// --- Change password section ---

const changePasswordSchemaFor = (rule: PasswordRule) =>
  z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: newPasswordSchema(rule, "New password"),
  });

type ChangePasswordValues = z.infer<ReturnType<typeof changePasswordSchemaFor>>;

function ChangePasswordSection({
  passwordRule,
}: {
  passwordRule: PasswordRule;
}) {
  const router = useRouter();

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchemaFor(passwordRule)),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
  });

  const onSubmit = async (data: ChangePasswordValues) => {
    const { data: result, error } = await authClient.changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });

    if (result?.user) {
      toast.success("Password changed");
      form.reset();
      router.refresh();
    }

    if (error) {
      toast.error(error.message ?? "Failed to change password");
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      id="change-password-form"
      className="flex flex-col gap-4"
    >
      <FieldSet>
        <FieldLegend>Password</FieldLegend>
        <FieldDescriptionText>
          Enter your current password and a new one to update it.
        </FieldDescriptionText>
        <FieldGroup>
          <FormController
            control={form.control}
            name="currentPassword"
            label="Current password"
            type="input"
            inputType="password"
          />
          <FormController
            control={form.control}
            name="newPassword"
            label="New password"
            type="input"
            inputType="password"
            placeholder={`Minimum ${passwordRule.passwordMin} characters`}
          />
        </FieldGroup>
      </FieldSet>
      <SaveButton
        form="change-password-form"
        disabled={form.formState.isSubmitting}
      />
    </form>
  );
}

// --- Signed-in devices section ---

function DevicesSection() {
  const { data: currentSession } = authClient.useSession();
  const format = useFormat();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authClient.listSessions().then(({ data }) => {
      if (!cancelled) setSessions((data ?? []) as DeviceSession[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const revoke = async (token: string) => {
    setPendingToken(token);
    const result = await revokeDeviceSession(token, authClient);
    setPendingToken(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    setSessions((prev) => prev?.filter((s) => s.token !== token) ?? prev);
    toast.success("Device signed out");
  };

  return (
    <div className="flex flex-col gap-4">
      <FieldSet>
        <FieldLegend>Signed-in devices</FieldLegend>
        <FieldDescriptionText>
          Where your account is currently signed in.
        </FieldDescriptionText>
        {sessions && sessions.length > 0 && (
          <Rows>
            {sortByLastActive(sessions).map((session) => {
              const isCurrent = session.id === currentSession?.session.id;
              return (
                <Row key={session.id}>
                  <RowMain>
                    <RowTitle>
                      {describeDevice(session)}
                      {isCurrent && (
                        <span className="text-ink-soft"> (this device)</span>
                      )}
                    </RowTitle>
                    <RowMeta>
                      Last active {format.relative(session.updatedAt)}
                    </RowMeta>
                  </RowMain>
                  {!isCurrent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(session.token)}
                      disabled={pendingToken === session.token}
                      className="shrink-0 text-ink-soft hover:text-danger"
                    >
                      Sign out
                    </Button>
                  )}
                </Row>
              );
            })}
          </Rows>
        )}
      </FieldSet>
    </div>
  );
}

// --- Delete account section ---

function BlockingProjectsList({
  projects,
}: {
  projects: DeletionPlanProject[];
}) {
  return (
    <Rows>
      {projects.map((project) => (
        <Row key={project.id}>
          <RowMain>
            <RowTitle>{project.name}</RowTitle>
            <RowMeta>
              {project.memberCount}{" "}
              {project.memberCount === 1 ? "member" : "members"}
            </RowMeta>
          </RowMain>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <AppLink
              href={settingsHref({
                section: "project",
                projectId: project.id,
                group: "members",
              })}
            >
              Members
            </AppLink>
          </Button>
        </Row>
      ))}
    </Rows>
  );
}

function DeleteAccountSection({ emailEnabled }: { emailEnabled: boolean }) {
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    browserApi.GET("/api/me/deletion-plan").then(({ data }) => {
      if (!cancelled && data) setPlan(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const blocked = (plan?.blocking.length ?? 0) > 0;

  const confirmDelete = async () => {
    const { error } = await authClient.deleteUser({
      callbackURL: "/",
      ...(emailEnabled ? {} : { password }),
    });

    if (error) {
      toast.error(error.message ?? "Failed to delete your account");
      return;
    }

    toast.success(
      emailEnabled
        ? "Check your email to confirm deleting your account."
        : "Your account has been deleted."
    );
  };
  const deletion = useDeleteGate("account", confirmDelete);

  return (
    <div className="flex flex-col gap-4">
      <FieldSet>
        <FieldLegend>Delete account</FieldLegend>
        <FieldDescriptionText>
          {plan && plan.deleted.length > 0
            ? `Deletes ${plan.deleted.length} project${plan.deleted.length === 1 ? "" : "s"} only you are in, along with your comments, activity and notes. Projects you share stay, with your comments and activity attributed to "Deleted user".`
            : `Deletes your comments, activity and notes. Your comments and activity on projects you share stay, attributed to "Deleted user".`}
        </FieldDescriptionText>

        {blocked && plan && (
          <div className="flex flex-col gap-2">
            <p className="text-body text-danger">
              You are the sole owner of{" "}
              {plan.blocking.length === 1
                ? "a project someone else is still in"
                : `${plan.blocking.length} projects someone else is still in`}
              . Transfer ownership or remove the other members before you can
              delete your account.
            </p>
            <BlockingProjectsList projects={plan.blocking} />
          </div>
        )}

        {!emailEnabled && !blocked && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="delete-account-password">
                Current password
              </FieldLabel>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </FieldGroup>
        )}
      </FieldSet>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={blocked || (!emailEnabled && password.length === 0)}
          onClick={() => deletion.request()}
        >
          Delete account
        </Button>
      </div>
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title="Delete your account?"
        description={
          emailEnabled
            ? "We'll email you a link to confirm. This cannot be undone."
            : "This cannot be undone."
        }
        confirmLabel="Delete account"
        confirmText="DELETE"
      />
    </div>
  );
}

// --- Main component ---

export default function ProfilePage({
  user,
  hasSaves,
  emailEnabled,
  passwordRule,
  selfDeletion,
}: {
  user: User;
  /** Whether the year-long save grid has anything on it; it is left out if not. */
  hasSaves: boolean;
  /** Whether the instance can send mail — decides which change-email and
   *  account-deletion path the corresponding sections offer. */
  emailEnabled: boolean;
  /** The instance's rule a new password is held to. */
  passwordRule: PasswordRule;
  /** Whether the instance lets an account holder delete their own account;
   *  the section is left out if not. */
  selfDeletion: boolean;
}) {
  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs crumbs={[{ label: "Profile", href: "/profile" }]} />
        }
        title={"Profile"}
        lede={"Your name, avatar, email address and password."}
      />
      <FormLayout>
        <FormRow as="section">
          <ProfileSection user={user} />
        </FormRow>
        <FormRow as="section">
          <ChangeEmailSection user={user} emailEnabled={emailEnabled} />
        </FormRow>
        <FormRow as="section">
          <ChangePasswordSection passwordRule={passwordRule} />
        </FormRow>
        <FormRow as="section">
          <DevicesSection />
        </FormRow>
        {hasSaves && (
          <FormRow as="section">
            <SectionHead>ACTIVITY</SectionHead>
            <ProfileHeatmap />
          </FormRow>
        )}
        {selfDeletion && (
          <FormRow as="section">
            <DeleteAccountSection emailEnabled={emailEnabled} />
          </FormRow>
        )}
      </FormLayout>
    </ScrollRoot>
  );
}
