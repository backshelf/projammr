"use client";

import { signInCopy } from "@/lib/sign-in-copy";
import type { Instance } from "@workspace/api/api";
import {
  AuthCardRegister,
  AuthCardSignIn,
} from "@workspace/ui/components/forms/auth-card-tabs";
import type { LoginRecovery } from "@workspace/ui/components/forms/login-card";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

/**
 * Loaded only when the card renders: its forms carry zod and react-hook-form,
 * and the home route also serves the project list to signed-in readers, who
 * never see it.
 */
const AuthCard = dynamic(() =>
  import("@workspace/ui/components/forms/auth-card").then((mod) => mod.AuthCard)
);

export function AuthWrapper({
  instance,
}: {
  /** Absent when `GET /api/instance` failed; the card falls back to its
   *  ordinary sign-in-or-register copy rather than blocking on it. */
  instance?: Pick<
    Instance,
    "hasUsers" | "registration" | "emailEnabled" | "passwordMin" | "passwordMax"
  >;
}) {
  const router = useRouter();
  const copy = instance && signInCopy(instance);
  const recovery: LoginRecovery | undefined =
    instance == null
      ? undefined
      : instance.emailEnabled
        ? { kind: "link", href: "/forgot-password" }
        : {
            kind: "message",
            text: "Ask your instance admin for a password reset link.",
          };
  const signIn = <AuthCardSignIn key="signin" recovery={recovery} />;
  const register = copy?.hideRegister ? null : (
    <AuthCardRegister key="register" passwordRule={instance} />
  );

  return (
    <AuthCard
      onSuccess={() => router.refresh()}
      title={copy?.title}
      description={copy?.description}
    >
      {copy?.defaultTab === "register"
        ? [register, signIn]
        : [signIn, register]}
    </AuthCard>
  );
}
