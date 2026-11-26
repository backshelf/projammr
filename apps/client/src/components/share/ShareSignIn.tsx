"use client";

import {
  AuthCardGuest,
  AuthCardSignIn,
} from "@workspace/ui/components/forms/auth-card-tabs";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

/**
 * Loaded only when the card renders: its forms carry zod and react-hook-form,
 * which a reader who already holds a session never needs.
 */
const AuthCard = dynamic(() =>
  import("@workspace/ui/components/forms/auth-card").then((mod) => mod.AuthCard)
);

/**
 * The one thing a share page asks for: a name to put on a comment. Reading and
 * listening need no account at all, so this only stands in for the composer —
 * and the guest tab leads, since signing up is beside the point here.
 *
 * A successful sign-in refreshes the route so the server-rendered session the
 * page was built with catches up.
 */
export function ShareSignIn() {
  const router = useRouter();

  return (
    <div className={"mt-4"}>
      <AuthCard onSuccess={() => router.refresh()}>
        <AuthCardGuest />
        <AuthCardSignIn />
      </AuthCard>
    </div>
  );
}
