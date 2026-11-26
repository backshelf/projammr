import { afterAll, describe, expect, it } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/auth.js";
import { projects } from "../db/schema/projects.js";
import {
  baseUrl,
  cookieHeaders,
  deleteSuiteUsers,
  signUpAndSignIn,
  type Actor,
} from "./fixtures.js";

const signUp = (name: string) => signUpAndSignIn(name, { plain: true });

async function createProject(as: Actor, name: string): Promise<number> {
  const res = await app.request(`${baseUrl}/projects`, {
    method: "POST",
    headers: cookieHeaders(as.cookie),
    body: JSON.stringify({ name, links: [] }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id as number;
}

async function invite(
  projectId: number,
  projectOwner: Actor,
  guest: Actor
): Promise<void> {
  const invited = await app.request(
    `${baseUrl}/projects/${projectId}/invites`,
    {
      method: "POST",
      headers: cookieHeaders(projectOwner.cookie),
      body: JSON.stringify({ email: guest.email, role: "editor" }),
    }
  );
  expect(invited.status).toBe(201);
  const { token } = await invited.json();
  const accepted = await app.request(`${baseUrl}/invites/${token}/accept`, {
    method: "POST",
    headers: cookieHeaders(guest.cookie),
  });
  expect(accepted.status).toBe(200);
}

const existing = async (ids: string[]) =>
  (
    await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))
  ).map((row) => row.id);

describe("deleteSuiteUsers", () => {
  const leftOver: string[] = [];

  afterAll(async () => {
    await deleteSuiteUsers(leftOver);
  });

  it("deletes the accounts and the projects they solely own", async () => {
    const solo = await signUp("Fixtures Solo");
    const other = await signUp("Fixtures Other");
    const soloProject = await createProject(solo, "Fixtures solo project");

    await deleteSuiteUsers([solo.userId, other.userId]);

    expect(await existing([solo.userId, other.userId])).toEqual([]);
    const gone = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, soloProject));
    expect(gone).toEqual([]);
  });

  it("skips an account a test already deleted", async () => {
    const deleted = await signUp("Fixtures Deleted");
    const kept = await signUp("Fixtures Kept");
    await db.delete(users).where(eq(users.id, deleted.userId));

    await deleteSuiteUsers([deleted.userId, kept.userId]);

    expect(await existing([deleted.userId, kept.userId])).toEqual([]);
  });

  it("leaves an account deleteAccount refuses and still deletes the rest", async () => {
    const projectOwner = await signUp("Fixtures Shared Owner");
    const member = await signUp("Fixtures Shared Member");
    const bystander = await signUp("Fixtures Bystander");
    const projectId = await createProject(projectOwner, "Fixtures shared");
    await invite(projectId, projectOwner, member);
    leftOver.push(projectOwner.userId, member.userId);

    await deleteSuiteUsers([
      projectOwner.userId,
      member.userId,
      bystander.userId,
    ]);

    expect((await existing([projectOwner.userId])).length).toBe(1);
    expect(await existing([member.userId, bystander.userId])).toEqual([]);

    const res = await app.request(`${baseUrl}/projects/${projectId}`, {
      method: "DELETE",
      headers: cookieHeaders(projectOwner.cookie),
    });
    expect(res.ok).toBe(true);
  });
});
