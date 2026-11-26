import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, spyOn } from "bun:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { app } from "../../app.js";
import { ENTITIES } from "../../entities/index.js";
import { setRegistration } from "./settings.js";
import { withMigratedDatabase } from "../../test/database.js";
import {
  authUrl,
  baseUrl,
  cookieHeaders,
  distinctCallerEnv,
  fakeWav,
  onDiskPath,
  password,
  signUpAndSignIn,
  testImage,
  trustedOrigin,
} from "../../test/fixtures.js";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";
import { adminAudit } from "../schema/admin-audit.js";
import { assets } from "../schema/assets.js";
import { authSessions, users } from "../schema/auth.js";
import { comments } from "../schema/comments.js";
import { images } from "../schema/images.js";
import { projects } from "../schema/projects.js";
import { storageUsage } from "../schema/storage-usage.js";
import { deleteAccount, deletionPlan } from "./account-deletion.js";
import { removeUserImages } from "./images.js";
import { lockAdminsAndTarget } from "./instance-users.js";

/**
 * These tests genuinely delete accounts and projects and lock the instance's
 * admin rows, so — like `settings.test.ts` next to it — they run in
 * the serial phase (`package.json`), away from every other file reading or
 * writing the shared `users` table in parallel.
 */

async function createProject(cookie: string, name: string): Promise<number> {
  const res = await app.request(`${baseUrl}/projects`, {
    method: "POST",
    headers: cookieHeaders(cookie),
    body: JSON.stringify({ name, links: [] }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id as number;
}

async function inviteAndAccept(
  ownerCookie: string,
  projectId: number,
  guest: { email: string; cookie: string },
  role: "editor" | "viewer" = "editor"
): Promise<void> {
  const invited = await app.request(
    `${baseUrl}/projects/${projectId}/invites`,
    {
      method: "POST",
      headers: cookieHeaders(ownerCookie),
      body: JSON.stringify({ email: guest.email, role }),
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

async function uploadAsset(
  cookie: string,
  projectId: number,
  name: string
): Promise<{ id: number; assetPath: string }> {
  const form = new FormData();
  form.append("file", new File([fakeWav], name, { type: "audio/wav" }));
  form.append("projectId", String(projectId));

  const res = await app.request(`${baseUrl}/assets/upload`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: trustedOrigin },
    body: form,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; assetPath: string };
}

async function commentOnProject(
  cookie: string,
  projectId: number
): Promise<number> {
  const res = await app.request(`${baseUrl}/comments`, {
    method: "POST",
    headers: cookieHeaders(cookie),
    body: JSON.stringify({
      targetType: "project",
      targetId: projectId,
      content: "Left before deleting my account",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id as number;
}

describe("deletionPlan", () => {
  it("puts a sole-owned shared project in blocking and a sole-member one in deleted", async () => {
    const owner = await signUpAndSignIn(`Deletion Plan Owner ${randomUUID()}`);
    const guest = await signUpAndSignIn(`Deletion Plan Guest ${randomUUID()}`);

    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    const solo = await createProject(owner.cookie, `Solo ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, guest);

    const plan = await deletionPlan(owner.userId);

    expect(plan.blocking.map((p) => p.id)).toContain(shared);
    expect(plan.deleted.map((p) => p.id)).toContain(solo);
    expect(plan.deleted.map((p) => p.id)).not.toContain(shared);
    expect(plan.blocking.map((p) => p.id)).not.toContain(solo);
  });

  it("leaves a project the account merely edits out of both lists", async () => {
    const owner = await signUpAndSignIn(`Deletion Plan Real ${randomUUID()}`);
    const member = await signUpAndSignIn(
      `Deletion Plan Member ${randomUUID()}`
    );
    const theirs = await createProject(owner.cookie, `Theirs ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, theirs, member);

    const plan = await deletionPlan(member.userId);

    expect(plan.blocking).toHaveLength(0);
    expect(plan.deleted).toHaveLength(0);
  });
});

describe("deleteAccount", () => {
  it("refuses with the blocking project when a shared project is still sole-owned", async () => {
    const owner = await signUpAndSignIn(`Delete Blocked ${randomUUID()}`);
    const guest = await signUpAndSignIn(`Delete Blocked Guest ${randomUUID()}`);
    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, guest);

    await expect(deleteAccount(owner.userId)).rejects.toMatchObject({
      status: "CONFLICT",
      body: expect.objectContaining({
        blocking: expect.arrayContaining([
          expect.objectContaining({ id: shared }),
        ]),
      }),
    });

    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, owner.userId));
    expect(row).toBeTruthy();
  });

  it("deletes a sole-member project and its files, and drops the account's unlinked notes", async () => {
    const owner = await signUpAndSignIn(`Delete Solo ${randomUUID()}`);
    const solo = await createProject(owner.cookie, `Solo ${randomUUID()}`);
    const asset = await uploadAsset(owner.cookie, solo, "doomed.wav");
    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);

    await deleteAccount(owner.userId);

    expect(
      await db.select().from(projects).where(eq(projects.id, solo))
    ).toHaveLength(0);
    expect(existsSync(onDiskPath(asset.assetPath))).toBe(false);
  });

  it("removes the account's avatar, its file and its storage usage, through the delete route", async () => {
    const actor = await signUpAndSignIn(`Delete Avatar ${randomUUID()}`, {
      plain: true,
    });
    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], "avatar.jpeg", { type: "image/jpeg" })
    );
    const upload = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: actor.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(upload.status).toBe(201);
    const avatar = (await upload.json()) as { id: number; assetPath: string };
    expect(existsSync(onDiskPath(avatar.assetPath))).toBe(true);
    const usage = () =>
      db
        .select({ bytes: storageUsage.bytes })
        .from(storageUsage)
        .where(
          and(
            eq(storageUsage.scopeKind, "user"),
            eq(storageUsage.scopeId, actor.userId)
          )
        );
    expect((await usage())[0]?.bytes).toBeGreaterThan(0);

    const res = await app.request(`${baseUrl}${authUrl}/delete-user`, {
      method: "POST",
      headers: cookieHeaders(actor.cookie),
      body: JSON.stringify({ password }),
    });
    expect(res.status).toBe(200);

    expect(
      await db.select().from(users).where(eq(users.id, actor.userId))
    ).toHaveLength(0);
    expect(
      await db.select().from(images).where(eq(images.id, avatar.id))
    ).toHaveLength(0);
    expect(existsSync(onDiskPath(avatar.assetPath))).toBe(false);
    expect((await usage())[0]?.bytes ?? 0).toBe(0);
  });

  it("removes the account's avatars when another removal takes some of them first", async () => {
    const actor = await signUpAndSignIn(`Delete Avatars ${randomUUID()}`, {
      plain: true,
    });
    const avatarIds: number[] = [];
    for (const name of ["one.jpeg", "two.jpeg", "three.jpeg"]) {
      const form = new FormData();
      form.append(
        "file",
        new File([await testImage()], name, { type: "image/jpeg" })
      );
      const upload = await app.request(`${baseUrl}/images/upload`, {
        method: "POST",
        headers: { Cookie: actor.cookie, Origin: trustedOrigin },
        body: form,
      });
      expect(upload.status).toBe(201);
      avatarIds.push(((await upload.json()) as { id: number }).id);
    }

    // Both removals list the same avatars and race to delete them, as a second
    // session deleting an avatar during the account's deletion does: the one
    // that loses an avatar finds it gone and goes on.
    await Promise.all([
      removeUserImages(actor.userId),
      removeUserImages(actor.userId),
    ]);

    expect(
      await db.select().from(images).where(inArray(images.id, avatarIds))
    ).toEqual([]);
    await deleteAccount(actor.userId);
    await db.delete(users).where(eq(users.id, actor.userId));
  });

  it("keeps an image the account uploaded to a project it does not own, without an uploader", async () => {
    const owner = await signUpAndSignIn(`Delete Keeper Owner ${randomUUID()}`, {
      plain: true,
    });
    const member = await signUpAndSignIn(
      `Delete Keeper Member ${randomUUID()}`,
      { plain: true }
    );
    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, member);

    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], "cover.jpeg", { type: "image/jpeg" })
    );
    form.append("projectId", String(shared));
    const upload = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: member.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(upload.status).toBe(201);
    const image = (await upload.json()) as { id: number };

    await deleteAccount(member.userId);
    await db.delete(users).where(eq(users.id, member.userId));

    const [row] = await db.select().from(images).where(eq(images.id, image.id));
    expect(row?.createdByUser).toBeNull();
  });

  it("writes no self-deletion audit row when a project delete fails", async () => {
    const owner = await signUpAndSignIn(`Delete Audit Fail ${randomUUID()}`);
    const solo = await createProject(owner.cookie, `Solo ${randomUUID()}`);

    const remove = spyOn(ENTITIES.project, "remove").mockRejectedValue(
      new Error("storage is unreachable")
    );
    try {
      await expect(deleteAccount(owner.userId)).rejects.toThrow(
        "storage is unreachable"
      );
    } finally {
      remove.mockRestore();
    }

    // Better Auth never got to drop the account, so it still exists and still
    // owns its project: an audit row saying it deleted itself would be a lie.
    expect(
      await db.select().from(projects).where(eq(projects.id, solo))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.targetUserId, owner.userId))
    ).toHaveLength(0);
  });

  it("nulls the author of comments and activity instead of losing them", async () => {
    const owner = await signUpAndSignIn(
      `Delete Comments Owner ${randomUUID()}`
    );
    const author = await signUpAndSignIn(
      `Delete Comments Author ${randomUUID()}`
    );
    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, author);
    const commentId = await commentOnProject(author.cookie, shared);

    await deleteAccount(author.userId);

    const [comment] = await db
      .select({ userId: comments.userId })
      .from(comments)
      .where(eq(comments.id, commentId));
    expect(comment?.userId).toBeNull();

    const [activityRow] = await db
      .select({ userId: activity.userId })
      .from(activity)
      .where(eq(activity.commentId, commentId));
    expect(activityRow?.userId).toBeNull();

    // deleteAccount is the beforeDelete hook body: it nulls the author and
    // leaves the row itself for Better Auth's own delete to remove next. The
    // project and its now-authorless comment are untouched either way.
    expect(
      await db.select().from(users).where(eq(users.id, author.userId))
    ).toHaveLength(1);
    expect(
      await db.select().from(projects).where(eq(projects.id, shared))
    ).toHaveLength(1);
  });

  it("keeps a member's upload in a shared project, with no uploader, once the account is gone", async () => {
    const owner = await signUpAndSignIn(`Delete Uploads Owner ${randomUUID()}`);
    const uploader = await signUpAndSignIn(
      `Delete Uploads Member ${randomUUID()}`
    );
    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, uploader);
    const asset = await uploadAsset(uploader.cookie, shared, "kept.wav");

    // The `users` delete is the one Better Auth runs after `beforeDelete`.
    await deleteAccount(uploader.userId);
    await db.delete(users).where(eq(users.id, uploader.userId));

    const [row] = await db
      .select({
        projectId: assets.projectId,
        createdByUser: assets.createdByUser,
      })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(row).toEqual({ projectId: shared, createdByUser: null });
    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);
  });
});

describe("the last sign-in-capable admin", () => {
  it("is refused deletion, under the same lock a role change takes", async () => {
    await withMigratedDatabase(async (database) => {
      const id = randomUUID();
      await database.insert(users).values({
        id,
        name: "Sole Admin",
        email: `${id}@example.com`,
        instanceRole: "admin",
      });

      await expect(deleteAccount(id, database)).rejects.toMatchObject({
        status: "CONFLICT",
        body: expect.objectContaining({
          message: expect.stringMatching(/keep one admin/i),
        }),
      });

      const { isOnlySignInCapableAdmin } = await database.transaction((tx) =>
        lockAdminsAndTarget(tx, id)
      );
      expect(isOnlySignInCapableAdmin).toBe(true);
    });
  }, 30_000);

  it("is not the last admin once another one can still sign in", async () => {
    await withMigratedDatabase(async (database) => {
      const first = randomUUID();
      const second = randomUUID();
      await database.insert(users).values([
        {
          id: first,
          name: "First Admin",
          email: `${first}@example.com`,
          instanceRole: "admin",
        },
        {
          id: second,
          name: "Second Admin",
          email: `${second}@example.com`,
          instanceRole: "admin",
        },
      ]);

      await deleteAccount(first, database);

      expect(
        await database.select().from(users).where(eq(users.id, first))
      ).toHaveLength(1);
    });
  }, 30_000);

  it("does not count a disabled admin as the one left", async () => {
    await withMigratedDatabase(async (database) => {
      const active = randomUUID();
      const disabled = randomUUID();
      await database.insert(users).values([
        {
          id: active,
          name: "Active Admin",
          email: `${active}@example.com`,
          instanceRole: "admin",
        },
        {
          id: disabled,
          name: "Disabled Admin",
          email: `${disabled}@example.com`,
          instanceRole: "admin",
          disabledAt: new Date(),
        },
      ]);

      await expect(deleteAccount(active, database)).rejects.toMatchObject({
        status: "CONFLICT",
      });
    });
  }, 30_000);
});

describe("GET /me/deletion-plan", () => {
  it("reports what deleting the caller's own account would do", async () => {
    const owner = await signUpAndSignIn(`Deletion Plan Route ${randomUUID()}`);
    const guest = await signUpAndSignIn(
      `Deletion Plan Route Guest ${randomUUID()}`
    );
    const shared = await createProject(owner.cookie, `Shared ${randomUUID()}`);
    const solo = await createProject(owner.cookie, `Solo ${randomUUID()}`);
    await inviteAndAccept(owner.cookie, shared, guest);

    const res = await app.request(`${baseUrl}/me/deletion-plan`, {
      headers: cookieHeaders(owner.cookie),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.blocking.map((p: { id: number }) => p.id)).toContain(shared);
    expect(body.deleted.map((p: { id: number }) => p.id)).toContain(solo);
  });
});

describe("session device name", () => {
  it("stores the X-Device-Name header a sign-in sent, for a session listing to label", async () => {
    await setRegistration("open", null);
    const env = distinctCallerEnv();
    const email = `device-name-${randomUUID()}@example.com`;
    const headers = { "Content-Type": "application/json" };

    const signUpRes = await app.request(
      `${baseUrl}/auth/sign-up/email`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          password: "password123",
          name: "Scanner",
        }),
      },
      env
    );
    expect(signUpRes.status).toBe(200);

    const signInRes = await app.request(
      `${baseUrl}/auth/sign-in/email`,
      {
        method: "POST",
        headers: { ...headers, "X-Device-Name": "StudioMac" },
        body: JSON.stringify({ email, password: "password123" }),
      },
      env
    );
    expect(signInRes.status).toBe(200);
    const { user } = await signInRes.json();

    const [session] = await db
      .select({ deviceName: authSessions.deviceName })
      .from(authSessions)
      .where(eq(authSessions.userId, user.id))
      .orderBy(desc(authSessions.createdAt));
    expect(session?.deviceName).toBe("StudioMac");
  });

  it("leaves the device name null for an ordinary sign-in", async () => {
    const actor = await signUpAndSignIn(`No Device Name ${randomUUID()}`);

    const [session] = await db
      .select({ deviceName: authSessions.deviceName })
      .from(authSessions)
      .where(eq(authSessions.userId, actor.userId));
    expect(session?.deviceName).toBeNull();
  });
});
