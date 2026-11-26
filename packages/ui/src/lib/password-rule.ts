import {
  PASSWORD_LENGTH_CEILING,
  PASSWORD_LENGTH_FLOOR,
} from "@workspace/settings/bounds";
import { z } from "zod";

/**
 * An instance's password length rule, named as `GET /api/instance` serves it,
 * so a caller holding the instance can pass it straight through.
 */
export type PasswordRule = { passwordMin: number; passwordMax: number };

/**
 * The widest rule any instance can set: what a form holds a new password to
 * when it was not handed the instance's own. The server checks its own rule
 * on every attempt either way.
 */
export const WIDEST_PASSWORD_RULE: PasswordRule = {
  passwordMin: PASSWORD_LENGTH_FLOOR,
  passwordMax: PASSWORD_LENGTH_CEILING,
};

/** A new password held to `rule`, with messages that name the bound it missed. */
export const newPasswordSchema = (
  rule: PasswordRule = WIDEST_PASSWORD_RULE,
  label = "Password"
) =>
  z
    .string()
    .min(
      rule.passwordMin,
      `${label} must be at least ${rule.passwordMin} characters long`
    )
    .max(
      rule.passwordMax,
      `${label} must be at most ${rule.passwordMax} characters long`
    );
