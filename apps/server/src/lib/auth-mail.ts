/**
 * The mail-sending side of every Better Auth callback `auth.ts` wires in when
 * `emailEnabled` — pulled out of the `betterAuth({...})` call itself so each
 * one is a plain, directly testable function rather than a closure buried in
 * a large config object. Better Auth calls each with a `request` second
 * argument these ignore.
 */
import { sendMail } from "./mail.js";
import {
  changeEmailConfirmationEmail,
  deleteAccountEmail,
  resetPasswordEmail,
  verificationEmail,
} from "./mail-templates.js";

type MailUser = { email: string };

/** `emailAndPassword.sendResetPassword`. */
export async function sendResetPasswordMail({
  user,
  url,
}: {
  user: MailUser;
  url: string;
}): Promise<void> {
  await sendMail({ to: user.email, ...resetPasswordEmail(url) });
}

/** `emailVerification.sendVerificationEmail`. */
export async function sendVerificationMail({
  user,
  url,
}: {
  user: MailUser;
  url: string;
}): Promise<void> {
  await sendMail({ to: user.email, ...verificationEmail(url) });
}

/** `user.changeEmail.sendChangeEmailConfirmation` — mailed to the current address. */
export async function sendChangeEmailConfirmationMail({
  user,
  newEmail,
  url,
}: {
  user: MailUser;
  newEmail: string;
  url: string;
}): Promise<void> {
  await sendMail({
    to: user.email,
    ...changeEmailConfirmationEmail(newEmail, url),
  });
}

/** `user.deleteUser.sendDeleteAccountVerification`. */
export async function sendDeleteAccountMail({
  user,
  url,
}: {
  user: MailUser;
  url: string;
}): Promise<void> {
  await sendMail({ to: user.email, ...deleteAccountEmail(url) });
}
