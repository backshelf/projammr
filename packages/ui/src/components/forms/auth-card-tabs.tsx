"use client";
import type { LoginRecovery } from "@workspace/ui/components/forms/login-card";
import type { PasswordRule } from "@workspace/ui/lib/password-rule";
import type { FC } from "react";

// The three legal children of `AuthCard`, kept apart from the card so a caller
// that loads the card lazily can still write its children without importing the
// forms behind it. They carry props only: `AuthCard` reads each element's `type`
// and props to build the tab list and renders the form itself.

export type AuthCardEmailProps = {
  // Prefill the email (used by the invite flow), and make it read-only when
  // accepting requires that exact address. With no `defaultEmail` there is
  // nothing to lock, so the field stays editable.
  defaultEmail?: string;
  lockEmail?: boolean;
};

export type AuthCardSignInProps = AuthCardEmailProps & {
  /** See {@link LoginRecovery}. */
  recovery?: LoginRecovery;
};

export type AuthCardRegisterProps = AuthCardEmailProps & {
  /** The instance's password rule, from `GET /api/instance`. */
  passwordRule?: PasswordRule;
};

export const AuthCardGuest: FC = () => null;
export const AuthCardSignIn: FC<AuthCardSignInProps> = () => null;
export const AuthCardRegister: FC<AuthCardRegisterProps> = () => null;
