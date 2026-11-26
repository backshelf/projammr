/**
 * The copy behind every mail `lib/mail.ts` sends: plain functions, each
 * returning a subject, a plain-text body and a minimal HTML body for the
 * same message. No template engine — the strings are short enough that one
 * would only add indirection, and the copy stays plain and specific rather
 * than reaching for a marketing voice.
 */

export type MailContent = { subject: string; text: string; html: string };

/**
 * Escapes a value bound for an HTML mail body. Applied to every interpolated
 * value in every template's HTML — an inviter's name, a project name, an
 * email address, a URL inside an `href` — never to `subject` or `text`, which
 * are not markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The shared shell every HTML body renders inside — no styling beyond what makes it readable as mail. */
function htmlBody(paragraphs: string[]): string {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n");
  return `<!doctype html><html><body>${body}</body></html>`;
}

/** `sendResetPassword`: a link to set a new password, requested by the account holder. */
export function resetPasswordEmail(url: string): MailContent {
  return {
    subject: "Reset your password",
    text: `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`,
    html: htmlBody([
      `<a href="${escapeHtml(url)}">Reset your password</a>`,
      "If you did not request this, ignore this email.",
    ]),
  };
}

/** `emailVerification.sendVerificationEmail`: confirms the address belongs to whoever signed up. */
export function verificationEmail(url: string): MailContent {
  return {
    subject: "Verify your email address",
    text: `Verify your email address: ${url}`,
    html: htmlBody([
      `<a href="${escapeHtml(url)}">Verify your email address</a>`,
    ]),
  };
}

/**
 * `user.changeEmail.sendChangeEmailConfirmation`: sent to the CURRENT
 * address, since that is the one the account has already proven it controls.
 */
export function changeEmailConfirmationEmail(
  newEmail: string,
  url: string
): MailContent {
  return {
    subject: "Approve your email change",
    text: `A request was made to change this account's email to ${newEmail}. Approve it: ${url}\n\nIf you did not request this, ignore this email.`,
    html: htmlBody([
      `A request was made to change this account's email to ${escapeHtml(newEmail)}.`,
      `<a href="${escapeHtml(url)}">Approve the change</a>`,
      "If you did not request this, ignore this email.",
    ]),
  };
}

/** `user.deleteUser.sendDeleteAccountVerification`: confirms the account holder, not an attacker, asked for deletion. */
export function deleteAccountEmail(url: string): MailContent {
  return {
    subject: "Confirm account deletion",
    text: `Confirm you want to delete this account: ${url}\n\nIf you did not request this, ignore this email.`,
    html: htmlBody([
      `<a href="${escapeHtml(url)}">Confirm account deletion</a>`,
      "If you did not request this, ignore this email.",
    ]),
  };
}

/** An invite to join a project, sent as soon as `createInvite` mints the link. */
export function inviteEmail(
  projectName: string,
  invitedByName: string | null,
  role: string,
  url: string,
  instanceName: string
): MailContent {
  const inviter = invitedByName ?? "Someone";
  return {
    subject: `${inviter} invited you to ${projectName}`,
    text: `${inviter} invited you to join "${projectName}" on ${instanceName} as ${role}.\n\n${url}`,
    html: htmlBody([
      `${escapeHtml(inviter)} invited you to join &quot;${escapeHtml(projectName)}&quot; on ${escapeHtml(instanceName)} as ${escapeHtml(role)}.`,
      `<a href="${escapeHtml(url)}">Accept the invite</a>`,
    ]),
  };
}
