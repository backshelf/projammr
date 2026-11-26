import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "bun:test";
import { db } from "../db/index.js";
import { invites, members } from "../db/schema/projects.js";
import { setupSuite, signUpAndSignIn, type Actor } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

afterEach(() => {
  restoreInstancePolicy();
});

const suite = setupSuite("Invites routes");
const { owner, outsider, requireProject, requestAs } = suite;

async function mkInvite(email: string) {
  const res = await requestAs(owner, `/projects/${suite.projectId}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role: "editor" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

const accept = (actor: Actor, token: string) =>
  requestAs(actor, `/invites/${token}/accept`, { method: "POST" });

const isMember = async (actor: Actor) => {
  const rows = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.projectId, suite.projectId),
        eq(members.userId, actor.userId)
      )
    );
  return rows.length > 0;
};

describe("invites", () => {
  it("previews the invited email to a caller holding only the token", async () => {
    requireProject();
    const token = await mkInvite(outsider.email);

    const res = await requestAs(owner, `/invites/${token}`, {
      headers: { Cookie: "" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: outsider.email,
      role: "editor",
      expired: false,
      accepted: false,
    });
  });

  it("keeps the preview from a signed-out caller while guest access is off, but not from an account", async () => {
    requireProject();
    const token = await mkInvite(outsider.email);
    stubInstancePolicy({ access: { guestAccess: false } });

    const signedOut = await requestAs(owner, `/invites/${token}`, {
      headers: { Cookie: "" },
    });
    expect(signedOut.status).toBe(401);

    const signedIn = await requestAs(outsider, `/invites/${token}`);
    expect(signedIn.status).toBe(200);
  });

  it("accepts an invite for the account the invite names", async () => {
    requireProject();
    const invitee = await signUpAndSignIn("Invites Invitee");
    const token = await mkInvite(invitee.email);

    const res = await accept(invitee, token);
    expect(res.status).toBe(200);
    expect(await isMember(invitee)).toBe(true);
  });

  it("accepts an invite when the addresses differ only in case", async () => {
    requireProject();
    const invitee = await signUpAndSignIn("Invites Case");
    const token = await mkInvite(invitee.email.toUpperCase());

    const res = await accept(invitee, token);
    expect(res.status).toBe(200);
    expect(await isMember(invitee)).toBe(true);
  });

  it("refuses another account with 403 invite_email_mismatch, adds no membership and leaves the invite open", async () => {
    requireProject();
    const wrong = await signUpAndSignIn("Invites Wrong");
    const token = await mkInvite("someone-else@example.com");

    const res = await accept(wrong, token);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("invite_email_mismatch");
    expect(body.error).toBe(
      "This invite was sent to a different email address"
    );
    expect(await isMember(wrong)).toBe(false);

    const [row] = await db
      .select({ acceptedAt: invites.acceptedAt })
      .from(invites)
      .where(eq(invites.token, token));
    expect(row!.acceptedAt).toBeNull();
  });

  it("answers 410 for an expired invite held by the wrong account", async () => {
    requireProject();
    const wrong = await signUpAndSignIn("Invites Expired Wrong");
    const token = await mkInvite("someone-else@example.com");
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.token, token));

    const res = await accept(wrong, token);
    expect(res.status).toBe(410);
    expect(await isMember(wrong)).toBe(false);
  });

  it("answers 409 for an accepted invite held by the wrong account", async () => {
    requireProject();
    const invitee = await signUpAndSignIn("Invites Taken");
    const wrong = await signUpAndSignIn("Invites Taken Wrong");
    const token = await mkInvite(invitee.email);
    expect((await accept(invitee, token)).status).toBe(200);

    const res = await accept(wrong, token);
    expect(res.status).toBe(409);
    expect(await isMember(wrong)).toBe(false);
  });
});
