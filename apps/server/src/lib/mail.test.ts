import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import { redirectLogs } from "./log.js";

// `mail.ts` reads `SMTP_URL`/`MAIL_FROM` through `env.ts`, which reads
// `process.env` once at import time — every case needs a fresh copy of both
// against a stubbed environment. Letting the real `.env` load would put the
// developer's own values back on every reload, and would risk a real send if
// `SMTP_URL` happened to be set outside the test.
mock.module("dotenv/config", () => ({}));

async function loadMail(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("./env.js")];
  delete require.cache[require.resolve("./mail.js")];
  for (const [key, value] of Object.entries(vars)) {
    stubEnv(key, value);
  }
  return import("./mail.js");
}

describe("fromHeader", () => {
  it("builds nodemailer's object form from a name and an address", async () => {
    const { fromHeader } = await loadMail({});
    expect(fromHeader("Alex's Studio", "noreply@test")).toEqual({
      name: "Alex's Studio",
      address: "noreply@test",
    });
  });
});

describe("sendMail", () => {
  beforeEach(() => {
    stubEnv("BETTER_AUTH_SECRET", "test-secret");
    stubEnv("NOTES_MASTER_KEY", Buffer.alloc(32, "t").toString("base64"));
    stubEnv("SMTP_URL", undefined);
    stubEnv("MAIL_FROM", undefined);
  });

  afterEach(() => {
    unstubAllEnvs();
  });

  it("throws when no SMTP_URL is configured", async () => {
    const { sendMail } = await loadMail({});
    await expect(
      sendMail({
        to: "reader@example.com",
        subject: "Reset your password",
        text: "text",
        html: "<p>html</p>",
      })
    ).rejects.toThrow(/no SMTP_URL/);
  });

  it("sends through the jsonTransport stub once SMTP_URL is the test sentinel", async () => {
    const { sendMail } = await loadMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    try {
      await sendMail({
        to: "reader@example.com",
        subject: "Reset your password",
        text: "https://app.test/reset-password?token=abc123",
        html: "<p>html</p>",
      });
    } finally {
      restore();
    }

    // The recipient and subject go out at `info`, the body at `debug` — a live
    // token has no business in a default deployment's log — so the assertions
    // read every line about this address rather than only the first.
    const sent = lines
      .filter((line) => line.includes("reader@example.com"))
      .join("");
    expect(sent).toContain("Reset your password");
    expect(sent).toContain("https://app.test/reset-password?token=abc123");
  });

  it("keeps the body, and the live token in it, out of the default log level", async () => {
    const { sendMail } = await loadMail({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    // `info` is what a deployment runs at (`LOG_LEVEL`, `lib/log.ts`). A reset,
    // verification or change-email link is a credential until it is used, so an
    // operator reading the container's stdout must not be able to lift one out
    // of it and take over the account that asked for the reset.
    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line), "info");
    try {
      await sendMail({
        to: "reader@example.com",
        subject: "Reset your password",
        text: "https://app.test/reset-password?token=abc123",
        html: "<p>html</p>",
      });
    } finally {
      restore();
    }

    const logged = lines.join("");
    expect(logged).toContain("reader@example.com");
    expect(logged).toContain("Reset your password");
    expect(logged).not.toContain("abc123");
  });
});
