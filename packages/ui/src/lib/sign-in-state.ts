import type { Instance } from "@workspace/api/api";

/** The state `GET /api/instance` puts a sign-in surface in. */
export type SignInKind = "first-account" | "closed" | "open";

/** Which state an instance is in and what a sign-in surface offers for it;
 *  each app words the state for itself. */
export type SignInState = {
  kind: SignInKind;
  /** Whether creating an account is not offered at all. */
  hideRegister: boolean;
  defaultTab: "login" | "register";
};

/**
 * The three states `GET /api/instance` can put a sign-in surface in.
 *
 * `hasUsers: false` always wins: the bootstrap defaults `registration` to
 * "open" until the first account closes it, so a fresh instance would
 * otherwise read as the ordinary open case.
 */
export function signInState(
  instance: Pick<Instance, "hasUsers" | "registration">
): SignInState {
  if (!instance.hasUsers) {
    return {
      kind: "first-account",
      hideRegister: false,
      defaultTab: "register",
    };
  }

  if (instance.registration === "closed") {
    return { kind: "closed", hideRegister: true, defaultTab: "login" };
  }

  return { kind: "open", hideRegister: false, defaultTab: "login" };
}
