import nodemailer from "nodemailer";
import { instanceValues } from "../db/queries/settings.js";
import { emailEnabled, mailFromAddress, smtpUrl } from "./env.js";
import { log } from "./log.js";

const logger = log("mail");

/**
 * The sentinel `SMTP_URL` the test suite sets instead of a real connection
 * string. `emailEnabled` only asks whether *some* transport is configured, so
 * tests get one exactly the way a deployment would — through `SMTP_URL` — but
 * backed by nodemailer's own `jsonTransport`, which serialises a message
 * instead of dialling anywhere. The alternative was injecting the transport
 * as a parameter; this reads the same env switch production does instead of
 * adding a second way to configure `sendMail`.
 */
const TEST_TRANSPORT_SENTINEL = "json";

const transport = (() => {
  if (!emailEnabled) return null;
  if (smtpUrl === TEST_TRANSPORT_SENTINEL) {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport(smtpUrl!);
})();

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * nodemailer's object form of a `From` header: the display name and the
 * address as separate fields, rather than a hand-formatted string.
 */
export function fromHeader(
  name: string,
  address: string
): { name: string; address: string } {
  return { name, address };
}

/**
 * Sends one mail through the configured transport. Every caller — password
 * reset, email verification, a change-email or delete-account confirmation,
 * invite delivery — goes through this one function, so `emailEnabled` is the
 * single switch that turns mail on for all of them at once.
 *
 * Throws if called with no transport configured; every call site is expected
 * to check {@link emailEnabled} (directly, or through a Better Auth option
 * that is only wired in when it is true) before reaching here.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!transport) {
    throw new Error("sendMail called with no SMTP_URL configured");
  }
  const { "instance-branding.mailSenderName": senderName } =
    await instanceValues(["instance-branding.mailSenderName"]);
  await transport.sendMail({
    from: fromHeader(senderName, mailFromAddress!),
    ...message,
  });
  logger.info("sent", { to: message.to, subject: message.subject });
  // The body carries the one thing the mail exists to deliver — a
  // password-reset, verification or change-email token, each of which is a
  // credential until it is used. At `info` it would sit in the container's
  // stdout and in whatever collects it, so an operator reading logs could take
  // over any account that had asked for a reset. It goes out at `debug`, which
  // a deployment opts into and the default `LOG_LEVEL=info` never writes.
  logger.debug("sent body", { to: message.to, text: message.text });
}
