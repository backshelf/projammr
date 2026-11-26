import { afterAll, describe, expect, it } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { desc, eq } from "drizzle-orm";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { setRegistration } from "../db/queries/settings.js";
import { checkLockout, recordFailure } from "../db/queries/signin-attempts.js";
import { adminAudit } from "../db/schema/admin-audit.js";
import { users, type InstanceRole } from "../db/schema/auth.js";
import { instanceSettingValues, settingsAudit } from "../db/schema/settings.js";
import { appVersion } from "../lib/version.js";
import {
  authUrl,
  baseUrl,
  cookieHeaders,
  distinctCallerEnv,
  password,
  setupSuite,
  signUpAndSignIn,
  type Actor,
} from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

/**
 * The instance-wide surfaces, driven through the app: what a signed-out caller
 * may know about the instance, what a closed instance does with a sign-up, and
 * who `/admin/*` answers at all.
 *
 * This file runs in the serial phase. Registration and instance roles are
 * process-wide state on the one instance every suite shares — flipping
 * registration closed while another file is signing its actors up would fail
 * that file rather than this one.
 */
const suite = setupSuite("Instance");
const { owner, editor } = suite;

/** Every public setting at its default, as a fresh instance carries them. */
const PUBLIC_DEFAULTS = Object.fromEntries(
  Object.values(SETTINGS)
    .filter(({ audience }) => audience === "public")
    .map((definition) => [definition.key, definition.default])
);

/** The instance's own settings, as `PATCH /settings/:scope/:id` addresses them. */
const INSTANCE_SETTINGS = "/settings/instance/instance";

/**
 * An account promoted straight in the row. An instance that was claimed long
 * ago has an admin already and no way to hand the role to a test's own actor
 * through the API, so the test writes it the way the bootstrap would have.
 */
const setRole = (actor: Actor, instanceRole: InstanceRole) =>
  db.update(users).set({ instanceRole }).where(eq(users.id, actor.userId));

const setDisabled = (actor: Actor, disabled: boolean) =>
  db
    .update(users)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(users.id, actor.userId));

/** Every `admin_audit` row naming this account as the target, newest first. */
const auditRowsAbout = (actor: Actor) =>
  db
    .select()
    .from(adminAudit)
    .where(eq(adminAudit.targetUserId, actor.userId))
    .orderBy(desc(adminAudit.id));

/** A sign-up straight at Better Auth, from an address the suite has not used. */
const signUp = (email: string) =>
  app.request(
    `${baseUrl}${authUrl}/sign-up/email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "Newcomer" }),
    },
    distinctCallerEnv()
  );

const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** An invite the suite's owner sent, which is what a closed instance admits. */
async function invite(email: string): Promise<void> {
  const res = await app.request(
    `${baseUrl}/projects/${suite.projectId}/invites`,
    {
      method: "POST",
      headers: cookieHeaders(owner.cookie),
      body: JSON.stringify({ email, role: "editor" }),
    }
  );
  expect(res.status).toBe(201);
}

afterAll(async () => {
  // Leave the instance as every other suite expects to find it.
  await setRegistration("open", null);
  if (!suite.setUpFailed) {
    await setRole(owner, "user");
    await setRole(editor, "user");
    await setDisabled(editor, false);
  }
});

describe("GET /api/instance", () => {
  it("tells a signed-out caller what the instance takes and what it runs", async () => {
    suite.requireProject();
    await setRegistration("closed", null);

    const res = await app.request(`${baseUrl}/instance`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      registration: "closed",
      hasUsers: true,
      emailEnabled: false,
      updateCheck: false,
      version: appVersion,
      passwordMin: 8,
      passwordMax: 128,
      guestAccess: true,
      selfDeletion: true,
      brand: {
        name: "Projammr",
        logoImageId: null,
        iconImageId: null,
        themeColour: "#080808",
        backgroundColour: "#080808",
        logoImagePath: null,
        iconImagePath: null,
      },
      settings: {
        ...PUBLIC_DEFAULTS,
        "instance-access.registration": "closed",
      },
    });
  });

  it("reports registration as the admin last left it", async () => {
    suite.requireProject();
    await setRegistration("open", null);

    const res = await app.request(`${baseUrl}/instance`);

    expect((await res.json()).registration).toBe("open");
  });

  it("reports the instance policy in force, not the one it booted with", async () => {
    suite.requireProject();
    stubInstancePolicy({
      access: {
        passwordMin: 12,
        passwordMax: 64,
        guestAccess: false,
        selfDeletion: false,
      },
      integrations: { updateCheck: true },
    });
    try {
      const res = await app.request(`${baseUrl}/instance`);

      expect(await res.json()).toMatchObject({
        passwordMin: 12,
        passwordMax: 64,
        guestAccess: false,
        selfDeletion: false,
        updateCheck: true,
      });
    } finally {
      restoreInstancePolicy();
    }
  });
});

describe("closed registration", () => {
  it("refuses a stranger", async () => {
    suite.requireProject();
    await setRegistration("closed", null);

    const res = await signUp(uniqueEmail("stranger"));

    expect(res.status).toBe(403);
    expect((await res.text()).toLowerCase()).toContain(
      "registration is closed"
    );
  });

  it("admits an address that holds an invite", async () => {
    suite.requireProject();
    const email = uniqueEmail("invited");
    await invite(email);
    await setRegistration("closed", null);

    const res = await signUp(email);

    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe(email);
  });

  // Closed is the state every real instance settles in the moment its first
  // account is created, so a guest caught by the registration gate would take
  // every share page on every deployment with it. The anonymous plugin's own
  // sign-in goes through the same `user.create.before` hook as a registration
  // and is let past only by the `isAnonymous` flag on that payload, which the
  // hook reads off a `Record<string, unknown>` because it is not there
  // statically. Nothing else would notice if that flag stopped arriving.
  it("still signs a share-page guest in", async () => {
    suite.requireProject();
    await setRegistration("closed", null);

    const res = await app.request(
      `${baseUrl}${authUrl}/sign-in/anonymous`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      distinctCallerEnv()
    );

    expect(res.status).toBe(200);
    expect((await res.json()).user.isAnonymous).toBe(true);
  });

  it("admits anyone once it is reopened", async () => {
    suite.requireProject();
    await setRegistration("open", null);

    const res = await signUp(uniqueEmail("welcome"));

    expect(res.status).toBe(200);
  });
});

describe("a disabled account", () => {
  it("stops its session resolving", async () => {
    suite.requireProject();
    const actor = await signUpAndSignIn("Instance Disabled");

    expect((await suite.requestAs(actor, "/me")).status).toBe(200);

    await setDisabled(actor, true);

    expect((await suite.requestAs(actor, "/me")).status).toBe(401);
  });

  it("gets nothing out of a fresh sign-in either", async () => {
    suite.requireProject();
    const actor = await signUpAndSignIn("Instance Locked Out");
    await setDisabled(actor, true);

    const res = await app.request(
      `${baseUrl}${authUrl}/sign-in/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: actor.email, password }),
      },
      distinctCallerEnv()
    );

    // The sign-in itself succeeds — Better Auth knows nothing about the flag —
    // but the session it hands back resolves as nobody.
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    expect((await suite.requestAs(actor, "/me")).status).toBe(401);
  });
});

describe("GET /admin/storage repositories and sharing", () => {
  it("gives each project a repositoryBytes and the instance a sharing line", async () => {
    suite.requireProject();
    await setRole(owner, "admin");

    const res = await suite.request("owner", "/admin/storage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: { repositoryBytes: number }[];
      sharing: { projects: number; savedBytes: number };
    };
    expect(body.projects.length).toBeGreaterThan(0);
    for (const project of body.projects) {
      expect(typeof project.repositoryBytes).toBe("number");
    }
    expect(typeof body.sharing.projects).toBe("number");
    expect(typeof body.sharing.savedBytes).toBe("number");
    await setRole(owner, "user");
  });
});

describe("/admin is invisible to everyone else", () => {
  it("answers 401 to a signed-out caller and 404 to a non-admin", async () => {
    suite.requireProject();
    await setRole(owner, "user");

    expect((await suite.request("anonymous", "/admin/storage")).status).toBe(
      401
    );
    expect((await suite.request("owner", "/admin/storage")).status).toBe(404);
    expect((await suite.request("owner", "/admin/users")).status).toBe(404);
    expect(
      (
        await suite.request("owner", `/admin/users/${editor.userId}`, {
          method: "PATCH",
          body: JSON.stringify({ instanceRole: "admin" }),
        })
      ).status
    ).toBe(404);
  });
});

describe("registration as an instance setting", () => {
  it("is read and written through the settings routes, audited, and shown to sign-up", async () => {
    suite.requireProject();
    await setRole(owner, "admin");
    await setRegistration("open", null);

    const read = await suite.request("owner", "/settings");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      "instance-access.registration": { effective: "open" },
    });

    const written = await suite.request("owner", INSTANCE_SETTINGS, {
      method: "PATCH",
      body: JSON.stringify({ "instance-access.registration": "closed" }),
    });
    expect(written.status).toBe(200);
    expect(await written.json()).toMatchObject({
      "instance-access.registration": { effective: "closed" },
    });

    expect(
      (await (await app.request(`${baseUrl}/instance`)).json()).registration
    ).toBe("closed");

    const [row] = await db
      .select()
      .from(instanceSettingValues)
      .where(eq(instanceSettingValues.key, "instance-access.registration"));
    expect(row).toMatchObject({ value: "closed", updatedBy: owner.userId });
    const [change] = await db
      .select()
      .from(settingsAudit)
      .where(eq(settingsAudit.key, "instance-access.registration"))
      .orderBy(desc(settingsAudit.id))
      .limit(1);
    expect(change).toMatchObject({
      scope: "instance",
      old: "open",
      new: "closed",
      actorId: owner.userId,
    });

    await setRegistration("open", null);
  });

  it("refuses a registration mode it does not have", async () => {
    suite.requireProject();
    await setRole(owner, "admin");

    const res = await suite.request("owner", INSTANCE_SETTINGS, {
      method: "PATCH",
      body: JSON.stringify({ "instance-access.registration": "invite-only" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("the admin API", () => {
  it("lists accounts a page at a time, with what each one is using", async () => {
    suite.requireProject();
    await setRole(owner, "admin");

    const res = await suite.request("owner", "/admin/users?page=1&pageSize=3");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBeLessThanOrEqual(3);
    expect(body.rowCount).toBeGreaterThan(body.rows.length);
    expect(body).toMatchObject({ page: 1, pageSize: 3 });
    expect(Object.keys(body.rows[0]).sort()).toEqual([
      "createdAt",
      "disabled",
      "email",
      "id",
      "instanceRole",
      "lastSeenAt",
      "name",
      "projectCount",
      "storageBytes",
    ]);
  });

  it("promotes another account, which the gate reads next request, without signing it out", async () => {
    suite.requireProject();
    await setRole(owner, "admin");
    const actor = await signUpAndSignIn("Instance Promoted");

    expect((await suite.requestAs(actor, "/admin/storage")).status).toBe(404);

    const promoted = await suite.request(
      "owner",
      `/admin/users/${actor.userId}`,
      { method: "PATCH", body: JSON.stringify({ instanceRole: "admin" }) }
    );
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({
      id: actor.userId,
      email: actor.email,
      instanceRole: "admin",
      disabled: false,
    });

    const [promotedAudit] = await auditRowsAbout(actor);
    expect(promotedAudit).toMatchObject({
      action: "role_changed",
      actorId: owner.userId,
      targetUserId: actor.userId,
      detail: { from: "user", to: "admin" },
    });

    // Nobody is signed out for being given more: the same session reads the
    // new role off the row on its next request.
    expect((await suite.requestAs(actor, "/admin/storage")).status).toBe(200);
  });

  // `/me` hands the client the session's copy of the role, so a demoted admin
  // whose session survived would keep the admin shell on screen until the
  // cookie cache lapsed. Revoking the sessions is what stops that.
  it("demotes another account and signs it out", async () => {
    suite.requireProject();
    await setRole(owner, "admin");
    const actor = await signUpAndSignIn("Instance Demoted");
    await setRole(actor, "admin");

    expect((await suite.requestAs(actor, "/admin/storage")).status).toBe(200);

    const demoted = await suite.request(
      "owner",
      `/admin/users/${actor.userId}`,
      { method: "PATCH", body: JSON.stringify({ instanceRole: "user" }) }
    );
    expect(demoted.status).toBe(200);
    expect((await suite.requestAs(actor, "/me")).status).toBe(401);

    const [demotedAudit] = await auditRowsAbout(actor);
    expect(demotedAudit).toMatchObject({
      action: "role_changed",
      detail: { from: "admin", to: "user" },
    });
  });

  it("disables an account and signs it out", async () => {
    suite.requireProject();
    await setRole(owner, "admin");
    const actor = await signUpAndSignIn("Instance Admin Disabled");

    const res = await suite.request("owner", `/admin/users/${actor.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ disabled: true });
    expect((await suite.requestAs(actor, "/me")).status).toBe(401);

    const [audit] = await auditRowsAbout(actor);
    expect(audit).toMatchObject({
      action: "account_disabled",
      actorId: owner.userId,
      targetUserId: actor.userId,
    });
  });

  it("answers 404 for an account that does not exist", async () => {
    suite.requireProject();
    await setRole(owner, "admin");

    const res = await suite.request("owner", "/admin/users/not-a-user", {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    });

    expect(res.status).toBe(404);
  });
});

// This instance runs with no SMTP_URL configured, so the account-driven
// reset request Better Auth normally mails a link for is disabled outright,
// and password recovery is only ever admin-issued.
describe("POST /auth/request-password-reset", () => {
  it("404s because this instance sends no mail", async () => {
    suite.requireProject();

    const res = await app.request(
      `${baseUrl}${authUrl}/request-password-reset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: owner.email }),
      }
    );

    expect(res.status).toBe(404);
  });
});

describe("POST /admin/users/:id/reset-link", () => {
  it("resets the password once, expires on a second use, and clears the lockout", async () => {
    suite.requireProject();
    await setRole(owner, "admin");
    const actor = await signUpAndSignIn("Instance Reset Link");

    // Six failures past the five free ones locks the account out.
    for (let i = 0; i < 6; i += 1) await recordFailure(actor.email);
    expect((await checkLockout(actor.email)).locked).toBe(true);

    const minted = await suite.request(
      "owner",
      `/admin/users/${actor.userId}/reset-link`,
      { method: "POST" }
    );
    expect(minted.status).toBe(200);
    const { url } = await minted.json();
    const token = new URL(url).searchParams.get("token");
    expect(token).toBeTruthy();

    expect((await checkLockout(actor.email)).locked).toBe(false);

    const [audit] = await auditRowsAbout(actor);
    expect(audit).toMatchObject({
      action: "reset_link_issued",
      actorId: owner.userId,
      targetUserId: actor.userId,
    });

    const newPassword = "a-freshly-reset-password";
    const reset = await app.request(`${baseUrl}${authUrl}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    expect(reset.status).toBe(200);

    const signedIn = await app.request(
      `${baseUrl}${authUrl}/sign-in/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: actor.email, password: newPassword }),
      },
      distinctCallerEnv()
    );
    expect(signedIn.status).toBe(200);

    // The token was consumed by the first reset — a second attempt with the
    // same token finds nothing to redeem, the way an expired one would.
    const reused = await app.request(`${baseUrl}${authUrl}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "a-second-password-attempt" }),
    });
    expect(reused.status).toBe(400);
  });

  it("answers 404 for an account that does not exist", async () => {
    suite.requireProject();
    await setRole(owner, "admin");

    const res = await suite.request(
      "owner",
      "/admin/users/not-a-user/reset-link",
      { method: "POST" }
    );

    expect(res.status).toBe(404);
  });

  it("is invisible to a non-admin", async () => {
    suite.requireProject();
    await setRole(owner, "user");

    const res = await suite.request(
      "owner",
      `/admin/users/${editor.userId}/reset-link`,
      { method: "POST" }
    );

    expect(res.status).toBe(404);
  });
});
