import { z } from "zod";
import { PASSWORD_LENGTH_CEILING, PASSWORD_LENGTH_FLOOR } from "../bounds.js";
import {
  defineGroup,
  defineSetting,
  INSTANCE_ONLY,
  wholeNumber,
} from "../define.js";

/**
 * Whether anyone may create an account (`open`) or new accounts come only
 * from an admin (`closed`).
 */
export const REGISTRATION_MODES = ["open", "closed"] as const;

export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

const REGISTRATION_LABELS: Record<RegistrationMode, string> = {
  open: "Open",
  closed: "Invite only",
};

const passwordLength = wholeNumber(
  PASSWORD_LENGTH_FLOOR,
  PASSWORD_LENGTH_CEILING
);

const passwordControl = {
  kind: "number",
  min: PASSWORD_LENGTH_FLOOR,
  max: PASSWORD_LENGTH_CEILING,
  step: 1,
  unit: "characters",
} as const;

const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

export const group = defineGroup({
  id: "instance-access",
  section: "instance",
  label: "Access",
  description:
    "Who can join this instance, how long a sign-in lasts, and what a wrong password costs.",
  order: 10,
});

export const settings = [
  defineSetting({
    key: "instance-access.registration",
    group: "instance-access",
    label: "Registration",
    description:
      "Open lets anyone with a link to this instance create an account. Invite only leaves new accounts to an admin.",
    keywords: ["sign up", "signup", "register", "invite", "accounts"],
    scopes: ["instance"],
    schema: z.enum(REGISTRATION_MODES),
    default: "open",
    control: {
      kind: "select",
      options: REGISTRATION_MODES.map((value) => ({
        value,
        label: REGISTRATION_LABELS[value],
      })),
    },
    audience: "public",
    lockable: false,
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.closeAfterFirst",
    group: "instance-access",
    label: "Close after the first account",
    description:
      "Once the first account is created on an open instance, registration switches to invite only behind it.",
    keywords: ["registration", "first user", "bootstrap", "sign up"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.invitesBypass",
    group: "instance-access",
    label: "Invites admit while invite only",
    description:
      "Someone holding an invite can create an account while registration is invite only. Off, nobody new can sign up until registration opens; an invite still adds an existing account to its project.",
    keywords: ["registration", "invite", "sign up", "closed"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.requireVerifiedEmail",
    group: "instance-access",
    label: "Verify new accounts' email",
    description:
      "While registration is open, a new account confirms its email before it can sign in. Applies only when the instance can send mail.",
    keywords: ["verification", "confirm", "email", "sign up"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.guestAccess",
    group: "instance-access",
    label: "Guest access",
    description:
      "People who are not signed in can open share links and comment as guests. Off also keeps invite links from signed-out people, so with registration invite only a new person cannot join by invite.",
    keywords: ["share", "guest", "anonymous", "signed out", "invite link"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.selfDeletion",
    group: "instance-access",
    label: "Members can delete their account",
    description:
      "Anyone can delete their own account from their profile. Off leaves it to an admin.",
    keywords: ["delete account", "remove account", "profile"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.sessionLifetimeDays",
    group: "instance-access",
    label: "Stay signed in for",
    description:
      "How long a sign-in lasts before it asks again. The server reads it as it starts, so a change applies to sign-ins after the next restart.",
    keywords: ["session", "sign in", "expiry", "lifetime", "log out"],
    schema: wholeNumber(1, 365),
    default: 7,
    control: { kind: "duration", unit: "d", min: 1, max: 365 },
    audience: "admin",
    restartRequired: true,
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.linkLifetimeMinutes",
    group: "instance-access",
    label: "Emailed links last",
    description:
      "How long a password reset or email confirmation link stays usable, and a reset link an admin hands out.",
    keywords: ["reset", "verification", "link", "expiry", "password"],
    schema: wholeNumber(5, WEEK_MINUTES),
    default: 60,
    control: { kind: "duration", unit: "min", min: 5, max: WEEK_MINUTES },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.passwordMin",
    group: "instance-access",
    label: "Shortest password",
    description:
      "The fewest characters a new password may have, at sign-up, on a reset and on a change.",
    keywords: ["password", "length", "minimum"],
    schema: passwordLength,
    default: PASSWORD_LENGTH_FLOOR,
    control: passwordControl,
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.passwordMax",
    group: "instance-access",
    label: "Longest password",
    description:
      "The most characters a new password may have. It can't be shorter than the shortest.",
    keywords: ["password", "length", "maximum"],
    schema: passwordLength,
    default: PASSWORD_LENGTH_CEILING,
    control: passwordControl,
    audience: "public",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.lockoutFreeFailures",
    group: "instance-access",
    label: "Wrong passwords before a lock",
    description:
      "How many wrong passwords an account takes within 15 minutes before sign-in to it is locked for a while.",
    keywords: ["lockout", "brute force", "failed sign in", "password"],
    schema: wholeNumber(1, 100),
    default: 5,
    control: { kind: "number", min: 1, max: 100, step: 1, unit: "tries" },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.lockoutBaseMinutes",
    group: "instance-access",
    label: "First lock",
    description:
      "How long the first lock lasts. Each wrong password after it doubles the lock, up to the longest lock.",
    keywords: ["lockout", "brute force", "failed sign in"],
    schema: wholeNumber(1, DAY_MINUTES),
    default: 1,
    control: { kind: "duration", unit: "min", min: 1, max: DAY_MINUTES },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-access.lockoutMaxMinutes",
    group: "instance-access",
    label: "Longest lock",
    description:
      "The longest a lock can grow to. It can't be shorter than the first lock.",
    keywords: ["lockout", "brute force", "failed sign in"],
    schema: wholeNumber(1, WEEK_MINUTES),
    default: 60,
    control: { kind: "duration", unit: "min", min: 1, max: WEEK_MINUTES },
    audience: "admin",
  }),
];
