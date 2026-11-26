import type { Instance } from "@workspace/api/api";
import { signInState, type SignInKind } from "@workspace/ui/lib/sign-in-state";

/** What the sign-in card says and offers, derived from the instance's own
 *  state rather than hand-written per caller. */
export type SignInCopy = {
  title: string;
  description: string;
  hideRegister: boolean;
  defaultTab: "login" | "register";
};

const COPY: Record<SignInKind, Pick<SignInCopy, "title" | "description">> = {
  "first-account": {
    title: "Create the first account",
    description:
      "Nobody has claimed this instance yet. The account you create here will administer it.",
  },
  closed: {
    title: "Sign in",
    description: "Accounts on this instance are by invite only.",
  },
  open: {
    title: "Sign in or create an account",
    description: "Sign in, or create an account to get started.",
  },
};

export function signInCopy(
  instance: Pick<Instance, "hasUsers" | "registration">
): SignInCopy {
  const { kind, hideRegister, defaultTab } = signInState(instance);
  return { ...COPY[kind], hideRegister, defaultTab };
}
