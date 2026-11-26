import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import { redirectLogs } from "./log.js";

// Every function here is a thin wrapper over `sendMail`, which reads
// `SMTP_URL`/`MAIL_FROM` through `env.ts` at import time — the same reload
// dance `env.test.ts` and `mail.test.ts` use.
mock.module("dotenv/config", () => ({}));

async function loadAuthMail(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("./env.js")];
  delete require.cache[require.resolve("./mail.js")];
  delete require.cache[require.resolve("./auth-mail.js")];
  for (const [key, value] of Object.entries(vars)) {
    stubEnv(key, value);
  }
  return import("./auth-mail.js");
}

const user = { email: "reader@example.com" };
const url = "https://app.test/reset-password?token=abc123";

/**
 * Every line the mail logger wrote about one address, joined. `sendMail`
 * records the recipient and subject at `info` and the body at `debug` — the
 * body carries a live token, so it stays out of a default deployment's log —
 * and an assertion about a link has to read both rather than the first line
 * that happens to name the address. Joining also fails an empty capture: a
 * `toContain` against `""` is what catches no mail being sent at all.
 */
const mailFor = (address: string, lines: string[]): string =>
  lines.filter((line) => line.includes(address)).join("");

describe("the Better Auth mail callbacks", () => {
  beforeEach(() => {
    stubEnv("BETTER_AUTH_SECRET", "test-secret");
    stubEnv("NOTES_MASTER_KEY", Buffer.alloc(32, "t").toString("base64"));
    stubEnv("SMTP_URL", undefined);
    stubEnv("MAIL_FROM", undefined);
  });

  afterEach(() => {
    unstubAllEnvs();
  });

  it("sendResetPasswordMail fails with no mail transport configured", async () => {
    const { sendResetPasswordMail } = await loadAuthMail({});
    await expect(sendResetPasswordMail({ user, url })).rejects.toThrow(
      /no SMTP_URL/
    );
  });

  it("sendResetPasswordMail sends the reset link once SMTP_URL is configured", async () => {
    const { sendResetPasswordMail } = await loadAuthMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await sendResetPasswordMail({ user, url });
    } finally {
      restore();
    }

    const sent = mailFor(user.email, lines);
    expect(sent).toContain(url);
  });

  it("sendVerificationMail sends the verification link", async () => {
    const { sendVerificationMail } = await loadAuthMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await sendVerificationMail({ user, url });
    } finally {
      restore();
    }

    const sent = mailFor(user.email, lines);
    expect(sent).toContain(url);
    expect(sent).toContain("Verify");
  });

  it("sendChangeEmailConfirmationMail names the new address and links to the old one's confirmation", async () => {
    const { sendChangeEmailConfirmationMail } = await loadAuthMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await sendChangeEmailConfirmationMail({
        user,
        newEmail: "new@example.com",
        url,
      });
    } finally {
      restore();
    }

    // Sent to the CURRENT address, which is the one already proven to
    // belong to the account holder.
    const sent = mailFor(user.email, lines);
    expect(sent).toContain(url);
    expect(sent).toContain("new@example.com");
  });

  it("sendDeleteAccountMail sends the confirmation link", async () => {
    const { sendDeleteAccountMail } = await loadAuthMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await sendDeleteAccountMail({ user, url });
    } finally {
      restore();
    }

    const sent = mailFor(user.email, lines);
    expect(sent).toContain(url);
  });
});
