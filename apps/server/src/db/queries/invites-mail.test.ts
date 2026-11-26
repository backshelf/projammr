import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import { app } from "../../app.js";
import { redirectLogs } from "../../lib/log.js";
import {
  baseUrl,
  cookieHeaders,
  setupSuite,
  signUpAndSignIn,
} from "../../test/fixtures.js";

// `createInvite` reads `emailEnabled`/`betterAuthUrl` through `env.ts` and
// sends through `mail.ts`, both captured at import time — the same reload
// dance `mail.test.ts` and `auth-mail.test.ts` use. `db.js` and the rest of
// the app graph are deliberately left cached, so this still runs against the
// one shared connection pool the suite's own project setup used.
mock.module("dotenv/config", () => ({}));

async function loadCreateInvite(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("../../lib/env.js")];
  delete require.cache[require.resolve("../../lib/mail.js")];
  delete require.cache[require.resolve("./invites.js")];
  for (const [key, value] of Object.entries(vars)) {
    stubEnv(key, value);
  }
  return import("./invites.js");
}

const suite = setupSuite("Invites Mail");
const { owner, requireProject } = suite;

describe("createInvite", () => {
  beforeEach(() => {
    stubEnv("BETTER_AUTH_SECRET", "test-secret");
    stubEnv("NOTES_MASTER_KEY", Buffer.alloc(32, "t").toString("base64"));
    stubEnv("SMTP_URL", undefined);
    stubEnv("MAIL_FROM", undefined);
  });

  afterEach(() => {
    unstubAllEnvs();
  });

  it("sends no mail when the instance has no SMTP_URL configured", async () => {
    requireProject();
    const { createInvite } = await loadCreateInvite({});

    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    let invite;
    try {
      invite = await createInvite(
        suite.projectId,
        { id: owner.userId, name: owner.name, role: "owner" },
        `no-mail-${Date.now()}@example.com`,
        "editor"
      );
    } finally {
      restore();
    }

    expect(invite.acceptedAt).toBeNull();
    expect(lines.find((line) => line.includes("sent"))).toBeUndefined();
  });

  it("sends the invite link to the invited address once SMTP_URL is configured", async () => {
    requireProject();
    const { createInvite } = await loadCreateInvite({
      SMTP_URL: "json",
      MAIL_FROM: "Projammr <noreply@test>",
    });

    const invitedEmail = `invited-${Date.now()}@example.com`;
    const lines: string[] = [];
    const restore = redirectLogs((line) => lines.push(line));
    let invite: Awaited<ReturnType<typeof createInvite>>;
    try {
      invite = await createInvite(
        suite.projectId,
        { id: owner.userId, name: owner.name, role: "owner" },
        invitedEmail,
        "editor"
      );
    } finally {
      restore();
    }

    // The recipient and subject go out at `info`, the body at `debug`, so the
    // token assertion has to read every line about this address, not the first.
    const sent = lines.filter((line) => line.includes(invitedEmail)).join("");
    expect(sent).toContain(owner.name);
    expect(sent).toContain(invite.token);
  });
});

describe("POST /projects/:id/invites over HTTP", () => {
  it("still creates the invite when the app was booted with no SMTP_URL", async () => {
    requireProject();
    // The app under test (`app.js`) was imported once, at boot, against this
    // file's real environment — module reloading only ever touches the
    // separately-imported copies above, so this exercises the unreloaded,
    // no-mail path the rest of the suite runs against.
    const invitee = await signUpAndSignIn("Invites Mail HTTP Invitee");
    const res = await app.request(
      `${baseUrl}/projects/${suite.projectId}/invites`,
      {
        method: "POST",
        headers: cookieHeaders(owner.cookie),
        body: JSON.stringify({ email: invitee.email, role: "viewer" }),
      }
    );
    expect(res.status).toBe(201);
  });
});
