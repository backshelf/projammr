import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { relationTypeByName } from "../db/queries/track-relation-types.js";
import { users } from "../db/schema/auth.js";
import { statuses } from "../db/schema/statuses.js";
import {
  baseUrl,
  fakeWav,
  setParentImage,
  setupSuite,
  signUpAndSignIn,
  testImage,
  trustedOrigin,
} from "../test/fixtures.js";

const suite = setupSuite("Scoping");
const {
  owner,
  requireProject,
  request,
  requestAs,
  mkTrack,
  mkCollection,
  mkSession,
  uniqueStatusName,
  uploadTypedAsset,
  uploadImage,
} = suite;

const asOwner = (path: string, init?: RequestInit) =>
  request("owner", path, init);

describe("project scoping", () => {
  /**
   * A second project, removed once the test that needed it is done. Scope
   * rules only mean something across a boundary, and the shared project is the
   * one every other test depends on.
   */
  async function withSecondProject<T>(
    run: (otherProjectId: number) => Promise<T>
  ): Promise<T> {
    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({ name: `Scope Project ${Date.now()}`, links: [] }),
    });
    expect(created.status).toBe(201);
    const otherProjectId = (await created.json()).id as number;

    try {
      return await run(otherProjectId);
    } finally {
      const removed = await request("owner", `/projects/${otherProjectId}`, {
        method: "DELETE",
      });
      expect(removed.ok).toBe(true);
    }
  }

  // Zod strips unknown keys, so a `projectId` in a patch body is dropped rather
  // than rejected: the assertion is on the stored row, not on a 400.
  it("ignores a suite.projectId in a track patch", async () => {
    requireProject();
    const trackId = await mkTrack("Immovable Track");

    await withSecondProject(async (otherProjectId) => {
      for (const attempt of [null, otherProjectId]) {
        const res = await request("owner", `/tracks/${trackId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "Still Here", projectId: attempt }),
        });
        expect(res.status).toBe(200);

        const track = await (
          await request("owner", `/tracks/${trackId}`)
        ).json();
        expect(track.projectId).toBe(suite.projectId);
        expect(track.title).toBe("Still Here");
      }
    });
  });

  it("ignores a suite.projectId in a collection and a session patch", async () => {
    requireProject();

    const collectionRes = await request("owner", "/collections", {
      method: "POST",
      body: JSON.stringify({
        title: "Immovable Collection",
        projectId: suite.projectId,
      }),
    });
    expect(collectionRes.status).toBe(201);
    const collectionId = (await collectionRes.json()).id as number;
    const session = await mkSession({ name: "Immovable Session" });

    const patched = await request("owner", `/collections/${collectionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed", projectId: null }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).projectId).toBe(suite.projectId);

    const patchedSession = await request("owner", `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", projectId: null }),
    });
    expect(patchedSession.status).toBe(200);
    expect((await patchedSession.json()).projectId).toBe(suite.projectId);
  });

  it("requires a suite.projectId on every create that is scoped to one", async () => {
    requireProject();

    const track = await request("owner", "/tracks", {
      method: "POST",
      body: JSON.stringify({ title: "Homeless Track", artists: ["A"] }),
    });
    expect(track.status).toBe(400);

    const collection = await request("owner", "/collections", {
      method: "POST",
      body: JSON.stringify({ title: "Homeless Collection" }),
    });
    expect(collection.status).toBe(400);

    const session = await request("owner", "/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Homeless Session", daw: "ableton" }),
    });
    expect(session.status).toBe(400);
  });

  it("keeps one project's session filepath out of another's", async () => {
    requireProject();
    const localFilepath = `/tmp/shared-layout-${Date.now()}.als`;

    const mine = await mkSession({ name: "Mine", localFilepath });

    await withSecondProject(async (otherProjectId) => {
      const theirs = await request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Theirs",
          daw: "ableton",
          projectId: otherProjectId,
          localFilepath,
        }),
      });
      expect(theirs.status).toBe(201);
      const theirSession = await theirs.json();

      expect(theirSession.id).not.toBe(mine.id);
      expect(theirSession.projectId).toBe(otherProjectId);

      const stillMine = await (
        await request("owner", `/sessions/${mine.id}`)
      ).json();
      expect(stillMine.projectId).toBe(suite.projectId);
    });
  });

  it("refuses every write to a global status, whoever asks", async () => {
    requireProject();

    const instanceAdmin = await signUpAndSignIn("Scoping Instance Admin");
    await db
      .update(users)
      .set({ instanceRole: "admin" })
      .where(eq(users.id, instanceAdmin.userId));

    const [global] = await db
      .insert(statuses)
      .values({ name: uniqueStatusName("Untouchable"), percentage: 5 })
      .returning();
    if (!global) throw new Error("failed to seed a global status");

    try {
      // A global status is fixed for everyone: the resolver refuses every
      // write with the status's own message, instance admin or not.
      for (const caller of ["owner", "editor", "outsider"] as const) {
        const updated = await request(caller, `/statuses/${global.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: uniqueStatusName("Renamed") }),
        });
        expect(updated.status, `PATCH as ${caller}`).toBe(403);
        expect((await updated.json()).error).toContain(
          "Cannot change global statuses"
        );

        const deleted = await request(caller, `/statuses/${global.id}`, {
          method: "DELETE",
        });
        expect(deleted.status, `DELETE as ${caller}`).toBe(403);
        expect((await deleted.json()).error).toContain(
          "Cannot delete global statuses"
        );
      }

      const updated = await requestAs(instanceAdmin, `/statuses/${global.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: uniqueStatusName("Renamed") }),
      });
      expect(updated.status, "PATCH as instance admin").toBe(403);
      expect((await updated.json()).error).toContain(
        "Cannot change global statuses"
      );

      const deleted = await requestAs(instanceAdmin, `/statuses/${global.id}`, {
        method: "DELETE",
      });
      expect(deleted.status, "DELETE as instance admin").toBe(403);
      expect((await deleted.json()).error).toContain(
        "Cannot delete global statuses"
      );

      // Still there after every attempt.
      const rows = await db
        .select()
        .from(statuses)
        .where(eq(statuses.id, global.id));
      expect(rows).toHaveLength(1);
    } finally {
      await db.delete(statuses).where(eq(statuses.id, global.id));
      await db
        .update(users)
        .set({ instanceRole: "user" })
        .where(eq(users.id, instanceAdmin.userId));
    }
  });

  it("no longer serves the global status list or a status by id", async () => {
    requireProject();

    for (const path of ["/statuses", "/statuses/98765432"]) {
      expect((await request("anonymous", path)).status).toBe(401);
      expect((await request("owner", path)).status).toBe(404);
    }
  });

  /**
   * Avatars are the one image with no project: they render for every signed-in
   * user, so they are gated on their uploader rather than on membership.
   */
  it("gates a project-less avatar on its uploader", async () => {
    requireProject();

    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], "avatar.jpeg", { type: "image/jpeg" })
    );
    const uploaded = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const avatar = await uploaded.json();
    expect(avatar.projectId).toBeNull();
    expect(avatar.scope).toBe("user");

    // Another signed-in user gets the same 404 a missing row gets, rather
    // than confirming that someone else's avatar exists.
    expect((await request("outsider", `/images/${avatar.id}`)).status).toBe(
      404
    );
    expect(
      (await request("outsider", `/images/${avatar.id}`, { method: "DELETE" }))
        .status
    ).toBe(404);

    expect((await request("owner", `/images/${avatar.id}`)).status).toBe(200);
    expect(
      (await request("owner", `/images/${avatar.id}`, { method: "DELETE" }))
        .status
    ).toBe(204);
  });

  /**
   * Every write that names a row by id must reject an id from outside the
   * project the request was authorized against, and reject it the same way it
   * rejects an id that does not exist — a distinguishable answer would map out
   * another project's ids.
   *
   * One second project holds a copy of every kind of row a body can name; each
   * test feeds one of its ids into a write against the shared project.
   */
  describe("foreign ids in write bodies", () => {
    let theirProjectId: number;
    let theirTrackId: number;
    let theirCollectionId: number;
    let theirAssetId: number;
    let theirImageId: number;
    let theirLabelId: number;
    let theirViewId: number;
    let theirStatusId: number;
    let theirCommentId: number;
    let globalStatusId: number;
    let fixtureError: unknown = null;

    const requireFixture = () => {
      requireProject();
      if (fixtureError) {
        throw new Error(
          `second-project fixture failed: ${String(fixtureError)}`
        );
      }
    };

    async function create(path: string, body: unknown) {
      const res = await request("owner", path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.status !== 201) {
        throw new Error(
          `POST ${path} returned ${res.status}: ${await res.text()}`
        );
      }
      return res.json();
    }

    beforeAll(async () => {
      if (suite.setUpFailed) return;
      try {
        theirProjectId = (
          await create("/projects", {
            name: `Foreign Project ${Date.now()}`,
            links: [],
          })
        ).id;

        theirTrackId = (
          await create("/tracks", {
            title: "Their Track",
            artists: ["Them"],
            projectId: theirProjectId,
          })
        ).id;
        theirCollectionId = (
          await create("/collections", {
            title: "Their Collection",
            projectId: theirProjectId,
          })
        ).id;
        theirStatusId = (
          await create("/statuses", {
            name: uniqueStatusName("Theirs"),
            percentage: 42,
            projectId: theirProjectId,
          })
        ).id;
        theirLabelId = (
          await create(`/projects/${theirProjectId}/labels`, {
            name: "their-label",
          })
        ).id;
        theirViewId = (
          await create(`/projects/${theirProjectId}/saved-views`, {
            name: "Their view",
            kind: "track",
            config: { query: "sort=title.asc" },
          })
        ).id;
        theirCommentId = (
          await create("/comments", {
            targetType: "track",
            targetId: theirTrackId,
            content: "Their comment",
          })
        ).id;

        theirAssetId = (
          await uploadTypedAsset(
            "theirs.mp3",
            "audio/mpeg",
            fakeWav,
            owner.cookie,
            theirProjectId
          )
        ).id;

        const imageForm = new FormData();
        imageForm.append(
          "file",
          new File([await testImage()], "theirs.jpeg", { type: "image/jpeg" })
        );
        imageForm.append("projectId", String(theirProjectId));
        const uploadedImage = await app.request(`${baseUrl}/images/upload`, {
          method: "POST",
          headers: { Cookie: owner.cookie, Origin: trustedOrigin },
          body: imageForm,
        });
        if (uploadedImage.status !== 201) {
          throw new Error(`image upload returned ${uploadedImage.status}`);
        }
        theirImageId = (await uploadedImage.json()).id;

        const [global] = await db
          .insert(statuses)
          .values({ name: uniqueStatusName("Shared Global"), percentage: 7 })
          .returning();
        if (!global) throw new Error("failed to seed a global status");
        globalStatusId = global.id;
      } catch (error) {
        fixtureError = error;
      }
    });

    afterAll(async () => {
      if (globalStatusId != null) {
        await db.delete(statuses).where(eq(statuses.id, globalStatusId));
      }
      if (theirProjectId == null) return;
      await request("owner", `/projects/${theirProjectId}`, {
        method: "DELETE",
      });
    });

    it("refuses a foreign track in a collection add", async () => {
      requireFixture();
      const collectionId = await mkCollection("Scoped Add");
      const mine = await mkTrack("Scoped Add Track");

      const single = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        { method: "POST", body: JSON.stringify({ trackId: theirTrackId }) }
      );
      expect(single.status).toBe(404);

      const bulk = await request(
        "owner",
        `/collections/${collectionId}/tracks/bulk`,
        {
          method: "POST",
          body: JSON.stringify({ trackIds: [mine, theirTrackId] }),
        }
      );
      expect(bulk.status).toBe(404);

      const listed = await (
        await request("owner", `/collections/${collectionId}/tracks`)
      ).json();
      expect(listed).toEqual([]);
    });

    it("refuses a foreign toTrackId in a track relation", async () => {
      requireFixture();
      const mine = await mkTrack("Scoped Relation Track");
      const remix = await relationTypeByName(suite.projectId, "remix");

      const res = await request("owner", `/tracks/${mine}/relations`, {
        method: "POST",
        body: JSON.stringify({
          toTrackId: theirTrackId,
          relationTypeId: remix!.id,
        }),
      });
      expect(res.status).toBe(404);

      const track = await (await request("owner", `/tracks/${mine}`)).json();
      expect(track.relations ?? []).toEqual([]);
    });

    it("refuses a foreign assetId on every attachment route", async () => {
      requireFixture();
      const trackId = await mkTrack("Scoped Attach Track");
      const collectionId = await mkCollection("Scoped Attach Collection");
      const session = await mkSession({ name: "Scoped Attach Session" });

      const targets = [
        `/projects/${suite.projectId}/attachments`,
        `/collections/${collectionId}/attachments`,
        `/tracks/${trackId}/attachments`,
        `/sessions/${session.id}/attachments`,
      ];

      for (const path of targets) {
        const res = await request("owner", path, {
          method: "POST",
          body: JSON.stringify({ assetId: theirAssetId }),
        });
        expect(res.status, `POST ${path}`).toBe(404);
      }

      const attached = await (
        await request("owner", `/tracks/${trackId}/attachments`)
      ).json();
      expect(attached).toEqual([]);
    });

    it("refuses a foreign asset when linking track audios", async () => {
      requireFixture();
      const trackId = await mkTrack("Scoped Audio Track");
      const mine = await uploadTypedAsset("mine.mp3", "audio/mpeg", fakeWav);

      const foreignInList = await request(
        "owner",
        `/tracks/${trackId}/audios`,
        {
          method: "POST",
          body: JSON.stringify({ assetIds: [mine.id, theirAssetId] }),
        }
      );
      expect(foreignInList.status).toBe(404);

      const foreignPrimary = await request(
        "owner",
        `/tracks/${trackId}/audios`,
        {
          method: "POST",
          body: JSON.stringify({
            assetIds: [theirAssetId],
            primaryAssetId: theirAssetId,
          }),
        }
      );
      expect(foreignPrimary.status).toBe(404);

      const audios = await (
        await request("owner", `/tracks/${trackId}/audios`)
      ).json();
      expect(audios).toEqual([]);
    });

    it("refuses a foreign parent when setting an image", async () => {
      requireFixture();
      const image = await uploadImage("scoped-parent.jpeg");

      for (const [kind, parentId] of [
        ["track", theirTrackId],
        ["collection", theirCollectionId],
      ] as const) {
        const res = await setParentImage(asOwner, {
          imageId: image.id,
          kind,
          parentId,
          projectId: suite.projectId,
        });
        expect(res.status, `setting a foreign ${kind} as parent`).toBe(404);
      }

      const theirTrack = await (
        await request("owner", `/tracks/${theirTrackId}`)
      ).json();
      expect(theirTrack.image).toBeNull();

      const theirCollection = await (
        await request("owner", `/collections/${theirCollectionId}`)
      ).json();
      expect(theirCollection.image).toBeNull();
    });

    it("refuses an image from another project when setting a parent", async () => {
      requireFixture();
      const trackId = await mkTrack("Scoped Image Track");

      const res = await setParentImage(asOwner, {
        imageId: theirImageId,
        kind: "track",
        parentId: trackId,
        projectId: suite.projectId,
      });
      expect(res.status).toBe(404);
    });

    it("refuses a label and a saved view from another project", async () => {
      requireFixture();

      const label = await request(
        "owner",
        `/projects/${suite.projectId}/labels/${theirLabelId}`,
        { method: "DELETE" }
      );
      expect(label.status).toBe(404);

      const patched = await request(
        "owner",
        `/projects/${suite.projectId}/saved-views/${theirViewId}`,
        { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) }
      );
      expect(patched.status).toBe(404);

      const deleted = await request(
        "owner",
        `/projects/${suite.projectId}/saved-views/${theirViewId}`,
        { method: "DELETE" }
      );
      expect(deleted.status).toBe(404);

      const theirLabels = await (
        await request("owner", `/projects/${theirProjectId}/labels`)
      ).json();
      expect(theirLabels.map((l: { id: number }) => l.id)).toContain(
        theirLabelId
      );

      const theirViews = await (
        await request("owner", `/projects/${theirProjectId}/saved-views`)
      ).json();
      const survivor = theirViews.find(
        (v: { id: number }) => v.id === theirViewId
      );
      expect(survivor?.name).toBe("Their view");
    });

    it("refuses a reply whose parent sits on another target", async () => {
      requireFixture();
      const mine = await mkTrack("Scoped Reply Track");
      const sibling = await mkTrack("Scoped Reply Sibling");

      const parent = await create("/comments", {
        targetType: "track",
        targetId: sibling,
        content: "On the sibling",
      });

      const wrongTarget = await request("owner", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: mine,
          content: "Reply",
          parentId: parent.id,
        }),
      });
      expect(wrongTarget.status).toBe(404);

      const otherProject = await request("owner", "/comments", {
        method: "POST",
        body: JSON.stringify({
          targetType: "track",
          targetId: mine,
          content: "Reply",
          parentId: theirCommentId,
        }),
      });
      expect(otherProject.status).toBe(404);

      const thread = await (
        await request("owner", `/comments/track/${mine}`)
      ).json();
      expect(thread).toEqual([]);
    });

    it("refuses a status from another project but accepts a global one", async () => {
      requireFixture();

      const created = await request("owner", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Scoped Status Track",
          artists: ["A"],
          projectId: suite.projectId,
          statusId: theirStatusId,
        }),
      });
      expect(created.status).toBe(404);

      const trackId = await mkTrack("Scoped Status Patch Track");
      const patched = await request("owner", `/tracks/${trackId}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: theirStatusId }),
      });
      expect(patched.status).toBe(404);

      const collectionId = await mkCollection("Scoped Status Collection");
      const collectionPatch = await request(
        "owner",
        `/collections/${collectionId}`,
        { method: "PATCH", body: JSON.stringify({ statusId: theirStatusId }) }
      );
      expect(collectionPatch.status).toBe(404);

      // A seeded global belongs to no project and stays usable by all of them.
      const global = await request("owner", `/tracks/${trackId}`, {
        method: "PATCH",
        body: JSON.stringify({ statusId: globalStatusId }),
      });
      expect(global.status).toBe(200);
      expect((await global.json()).statusId).toBe(globalStatusId);
    });

    it("refuses a foreign trackId on a session write", async () => {
      requireFixture();

      // A create names its own project, so the request is gated on that one
      // and the foreign track is simply not found in it.
      const created = await request("owner", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: "Scoped Session",
          daw: "ableton",
          projectId: suite.projectId,
          trackId: theirTrackId,
        }),
      });
      expect(created.status).toBe(404);

      // A patch names its session in the path, so the body's track is checked
      // against the session's project instead.
      const session = await mkSession({ name: "Scoped Session Patch" });
      const patched = await request("owner", `/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ trackId: theirTrackId }),
      });
      expect(patched.status).toBe(404);

      const stored = await (
        await request("owner", `/sessions/${session.id}`)
      ).json();
      expect(stored.trackId).toBeNull();
    });

    it("answers 409 when the same track is added to a collection twice", async () => {
      requireFixture();
      const collectionId = await mkCollection("Duplicate Add");
      const trackId = await mkTrack("Duplicate Add Track");

      const first = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ trackId }),
        }
      );
      expect(first.status).toBe(200);

      const second = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        { method: "POST", body: JSON.stringify({ trackId }) }
      );
      expect(second.status).toBe(409);
    });
  });
});
