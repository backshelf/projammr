"use client";

import { setProjectCookie } from "@/actions/cookie";
import { acceptInvite } from "@/actions/members";
import { hrefFromParsedRoute } from "@/lib/utils";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { AuthCard } from "@workspace/ui/components/forms/auth-card";
import type { PasswordRule } from "@workspace/ui/lib/password-rule";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export default function InviteFlow({
  token,
  email,
  signedIn,
  passwordRule,
}: {
  token: string;
  /** The address the invite was sent to; accepting requires an account
   *  holding it, so the signed-out forms carry it read-only. */
  email: string;
  signedIn: boolean;
  /** The instance's password rule, for the register form; absent when the
   *  instance could not be read. */
  passwordRule?: PasswordRule;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  if (!signedIn) {
    return (
      <AuthCard
        description={`Register with ${email}, or sign in if you already have an account.`}
        onSuccess={() => router.refresh()}
      >
        <AuthCard.Register
          defaultEmail={email}
          lockEmail
          passwordRule={passwordRule}
        />
        <AuthCard.SignIn defaultEmail={email} lockEmail />
      </AuthCard>
    );
  }

  const handleAccept = async () => {
    setAccepting(true);
    const result = await acceptInvite(token);
    if (isActionError(result)) {
      setAccepting(false);
      toast.error(result.error);
      return;
    }
    await setProjectCookie(result.projectId);
    toast.success("You've joined the project");
    router.replace(hrefFromParsedRoute({ kind: "project" }, result.projectId));
  };

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-4 pt-6">
        <Button onClick={handleAccept} disabled={accepting}>
          {accepting ? "Joining..." : "Accept invite"}
        </Button>
      </CardContent>
    </Card>
  );
}
