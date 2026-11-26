import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { withProjectPolicyForTest } from "../db/queries/project-policy.js";
import { sharelinks } from "../db/schema/sharelinks.js";
import { trackAudios, tracks } from "../db/schema/tracks.js";
import {
  baseUrl,
  cookieHeaders,
  setupSuite,
  signInAsGuest,
} from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

/**
 * Every guest in this file signs in from the same address, and there are more
 * of them than the `guest-signin` bucket's burst: room enough that the bucket,
 * which `rate-limit.test.ts` covers, never decides a case here.
 */
const GUEST_SIGNIN_ROOM = {
  rateLimits: { "guest-signin": { burst: 50, perMinute: 50 } },
};

beforeEach(() => {
  stubInstancePolicy(GUEST_SIGNIN_ROOM);
});

afterEach(() => {
  restoreInstancePolicy();
});

const suite = setupSuite("Sharelinks routes");
const {
  owner,
  requireProject,
  request,
  mkTrack,
  mkCollection,
  uploadAsset,
  uploadImage,
} = suite;

/** A track with one audio version behind it, bypassing the upload pipeline —
 *  these tests are about the share routes, not about transcoding. */
async function mkSharedTrack(title: string) {
  const trackId = await mkTrack(title);
  const asset = await uploadAsset(`${title}.jpeg`);
  const [audio] = await db
    .insert(trackAudios)
    .values({ trackId, assetId: asset.id, version: 1, isPrimary: true })
    .returning({ id: trackAudios.id });
  return { trackId, trackAudioId: audio!.id };
}

async function mkShare(trackId: number, body: Record<string, unknown> = {}) {
  const res = await request("owner", "/share/connected", {
    method: "POST",
    body: JSON.stringify({ entityType: "track", entityId: trackId, ...body }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; tracks: { id: number }[] };
}

describe("share links", () => {
  it("serves the share to a caller holding nothing but the token", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Open Share");
    const { token } = await mkShare(trackId);

    const read = await request("anonymous", `/share/${token}`);
    expect(read.status).toBe(200);
    const share = await read.json();
    expect(share.tracks[0].trackAudio.id).toBe(trackAudioId);

    const thread = await request(
      "anonymous",
      `/share/${token}/comments?id=${trackAudioId}`
    );
    expect(thread.status).toBe(200);
    expect(await thread.json()).toEqual([]);
  });

  it("rejects a token that grants no such track", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Narrow Share");
    const other = await mkSharedTrack("Other Track");
    const { token } = await mkShare(trackId);

    const thread = await request(
      "anonymous",
      `/share/${token}/comments?id=${other.trackAudioId}`
    );
    expect(thread.status).toBe(404);
  });

  it("revoking a share link answers 204 and every guest route answers 410 revoked", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Revoked Share");
    const { token } = await mkShare(trackId);

    const revoked = await request("owner", `/share/${token}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);

    for (const path of [
      `/share/${token}`,
      `/share/${token}/stream?id=${trackAudioId}`,
      `/share/${token}/cover/${trackAudioId}?w=64`,
      `/share/${token}/comments?id=${trackAudioId}`,
    ]) {
      const res = await request("anonymous", path);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.code).toBe("revoked");
      expect(body.error).toBe("This share link was turned off");
    }
  });

  it("answers 404 with no code for a token that never existed", async () => {
    requireProject();
    const res = await request("anonymous", "/share/never-issued");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBeUndefined();
  });

  it("answers 204 to turning off a link that is already off, and keeps the first timestamp", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Revoked Twice");
    const { token } = await mkShare(trackId);

    expect(
      (await request("owner", `/share/${token}`, { method: "DELETE" })).status
    ).toBe(204);
    const [first] = await db
      .select({ revokedAt: sharelinks.revokedAt })
      .from(sharelinks)
      .where(eq(sharelinks.token, token));

    expect(
      (await request("owner", `/share/${token}`, { method: "DELETE" })).status
    ).toBe(204);
    const [second] = await db
      .select({ revokedAt: sharelinks.revokedAt })
      .from(sharelinks)
      .where(eq(sharelinks.token, token));

    expect(first!.revokedAt).toBeInstanceOf(Date);
    expect(second!.revokedAt).toEqual(first!.revokedAt!);
  });

  it("answers 410 revoked for a link that is both revoked and expired", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Revoked And Expired");
    const { token } = await mkShare(trackId, {
      expiresAt: new Date("2020-01-01").toISOString(),
    });

    await request("owner", `/share/${token}`, { method: "DELETE" });

    const res = await request("anonymous", `/share/${token}`);
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("revoked");
  });

  it("answers 410 expired for a link past its expiry that was never turned off", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Expired Share");
    const { token } = await mkShare(trackId, {
      expiresAt: new Date("2020-01-01").toISOString(),
    });

    const res = await request("anonymous", `/share/${token}`);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe("expired");
    expect(body.error).toBe("This share link has expired");
  });

  it("treats a revoked link as gone for the owner: it leaves the list and cannot be edited, converted or refreshed", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Revoked Managed");
    const { token } = await mkShare(trackId);
    await request("owner", `/share/${token}`, { method: "DELETE" });

    const listed = await request(
      "owner",
      `/share?entityType=track&entityId=${trackId}`
    );
    expect(
      ((await listed.json()) as { token: string }[]).map((l) => l.token)
    ).not.toContain(token);

    const patched = await request("owner", `/share/${token}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "still here?" }),
    });
    expect(patched.status).toBe(404);

    const converted = await request("owner", `/share/${token}/convert`, {
      method: "POST",
      body: JSON.stringify({ shareType: "snapshot" }),
    });
    expect(converted.status).toBe(404);

    const refreshed = await request("owner", `/share/${token}/tracks`, {
      method: "PATCH",
      body: JSON.stringify({ trackAudios: [{ id: trackAudioId }] }),
    });
    expect(refreshed.status).toBe(404);
  });

  it("carries no revoke timestamp in any body", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("No Timestamp");
    const { token } = await mkShare(trackId);

    const bodies = [
      await (await request("anonymous", `/share/${token}`)).text(),
      await (
        await request("owner", `/share?entityType=track&entityId=${trackId}`)
      ).text(),
      await (
        await request("owner", `/share/${token}`, {
          method: "PATCH",
          body: JSON.stringify({ description: "edited" }),
        })
      ).text(),
    ];
    for (const body of bodies) expect(body).not.toContain("revokedAt");
  });

  it("lets a guest post, reply to, edit and delete a comment", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Guest Comments");
    const { token } = await mkShare(trackId);
    const guest = await signInAsGuest();

    const posted = await app.request(`${baseUrl}/share/${token}/comments`, {
      method: "POST",
      headers: cookieHeaders(guest),
      body: JSON.stringify({
        trackAudioId,
        content: "Snare is late here",
        positionMs: 4200,
      }),
    });
    expect(posted.status).toBe(201);
    const comment = await posted.json();
    expect(comment.positionMs).toBe(4200);

    const replied = await app.request(`${baseUrl}/share/${token}/comments`, {
      method: "POST",
      headers: cookieHeaders(guest),
      body: JSON.stringify({
        trackAudioId,
        content: "Never mind",
        parentId: comment.id,
      }),
    });
    expect(replied.status).toBe(201);

    const edited = await app.request(
      `${baseUrl}/share/${token}/comments/${comment.id}`,
      {
        method: "PATCH",
        headers: cookieHeaders(guest),
        body: JSON.stringify({ content: "Snare drags a little" }),
      }
    );
    expect(edited.status).toBe(200);
    expect((await edited.json()).content).toBe("Snare drags a little");

    const removed = await app.request(
      `${baseUrl}/share/${token}/comments/${comment.id}`,
      { method: "DELETE", headers: cookieHeaders(guest) }
    );
    expect(removed.status).toBe(204);
  });

  it("tells a guest they may amend only their own comments and resolve none", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Guest Can");
    const { token } = await mkShare(trackId);
    const guest = await signInAsGuest();

    const post = async (cookie: string, content: string, parentId?: number) => {
      const res = await app.request(`${baseUrl}/share/${token}/comments`, {
        method: "POST",
        headers: cookieHeaders(cookie),
        body: JSON.stringify({ trackAudioId, content, parentId }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as {
        id: number;
        viewerCan: { amend: boolean; resolve: boolean };
      };
    };

    const mine = await post(guest, "Guest note");
    const teams = await post(owner.cookie, "Team note");
    await post(owner.cookie, "Team reply", mine.id);
    expect(mine.viewerCan).toEqual({ amend: true, resolve: false });

    const read = await app.request(
      `${baseUrl}/share/${token}/comments?id=${trackAudioId}`,
      { headers: cookieHeaders(guest) }
    );
    const thread = (await read.json()) as {
      id: number;
      resolver: unknown;
      viewerCan: { amend: boolean; resolve: boolean };
      replies: { viewerCan: { amend: boolean; resolve: boolean } }[];
    }[];

    const own = thread.find((c) => c.id === mine.id)!;
    expect(own.resolver).toBeNull();
    expect(own.viewerCan).toEqual({ amend: true, resolve: false });
    expect(own.replies[0]!.viewerCan).toEqual({ amend: false, resolve: false });
    expect(thread.find((c) => c.id === teams.id)!.viewerCan).toEqual({
      amend: false,
      resolve: false,
    });
  });

  it("while guest access is off, turns away a signed-out reader and a guest but still serves a member", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Members Only");
    const { token } = await mkShare(trackId);
    const guest = await signInAsGuest();
    stubInstancePolicy({
      ...GUEST_SIGNIN_ROOM,
      access: { guestAccess: false },
    });

    const signedOut = await request("anonymous", `/share/${token}`);
    expect(signedOut.status).toBe(401);
    expect(
      (await request("anonymous", `/share/${token}/stream?id=${trackAudioId}`))
        .status
    ).toBe(401);

    const asGuest = await app.request(`${baseUrl}/share/${token}`, {
      headers: cookieHeaders(guest),
    });
    expect(asGuest.status).toBe(401);
    const guestComment = await app.request(
      `${baseUrl}/share/${token}/comments`,
      {
        method: "POST",
        headers: cookieHeaders(guest),
        body: JSON.stringify({ trackAudioId, content: "Let me in" }),
      }
    );
    expect(guestComment.status).toBe(401);

    const member = await request("owner", `/share/${token}`);
    expect(member.status).toBe(200);
  });

  it("refuses a comment from a caller with no session at all", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Read Only Share");
    const { token } = await mkShare(trackId);

    const posted = await request("anonymous", `/share/${token}/comments`, {
      method: "POST",
      body: JSON.stringify({ trackAudioId, content: "Anonymous" }),
    });
    expect(posted.status).toBe(401);
  });

  it("serves the shared track's cover at the widths it offers, and no others", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Covered Share");
    const image = await uploadImage("share-cover.jpeg");
    await db
      .update(tracks)
      .set({ image: image.assetPath })
      .where(eq(tracks.id, trackId));

    const { token } = await mkShare(trackId);

    const cover = await request(
      "anonymous",
      `/share/${token}/cover/${trackAudioId}?w=64`
    );
    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toBe("image/webp");

    const badWidth = await request(
      "anonymous",
      `/share/${token}/cover/${trackAudioId}?w=100`
    );
    expect(badWidth.status).toBe(400);
  });

  it("serves the shared track's cover as a JPEG on format=jpeg, and refuses any other format", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Jpeg Cover Share");
    const image = await uploadImage("share-cover-jpeg.jpeg");
    await db
      .update(tracks)
      .set({ image: image.assetPath })
      .where(eq(tracks.id, trackId));

    const { token } = await mkShare(trackId);
    const path = `/share/${token}/cover/${trackAudioId}`;

    const jpeg = await request("anonymous", `${path}?w=1024&format=jpeg`);
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");

    const webp = await request("anonymous", `${path}?w=64&format=webp`);
    expect(webp.headers.get("content-type")).toBe("image/webp");

    const bare = await request("anonymous", `${path}?w=64`);
    expect(bare.headers.get("content-type")).toBe("image/webp");

    const png = await request("anonymous", `${path}?w=64&format=png`);
    expect(png.status).toBe(400);
  });

  it("lists an entity's links, expired ones included, and nobody else's", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Listed Share");
    const { trackId: otherTrackId } = await mkSharedTrack("Unlisted Share");

    const live = await mkShare(trackId);
    const expired = await mkShare(trackId, {
      expiresAt: new Date("2020-01-01").toISOString(),
    });
    const other = await mkShare(otherTrackId);

    const listed = await request(
      "owner",
      `/share?entityType=track&entityId=${trackId}`
    );
    expect(listed.status).toBe(200);
    const tokens = ((await listed.json()) as { token: string }[]).map(
      (link) => link.token
    );
    expect(tokens).toContain(live.token);
    expect(tokens).toContain(expired.token);
    expect(tokens).not.toContain(other.token);
  });

  it("lets only an editor of the project list an entity's links", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Gated List");
    await mkShare(trackId);

    const path = `/share?entityType=track&entityId=${trackId}`;
    expect((await request("anonymous", path)).status).toBe(401);
    expect((await request("outsider", path)).status).toBe(403);
    expect((await request("viewer", path)).status).toBe(403);
    expect((await request("editor", path)).status).toBe(200);
  });

  it("offers every version of every track a snapshot could freeze", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Two Versions");
    const second = await uploadAsset("two-versions-b.jpeg");
    const [secondAudio] = await db
      .insert(trackAudios)
      .values({ trackId, assetId: second.id, version: 2, isPrimary: false })
      .returning({ id: trackAudios.id });

    const res = await request(
      "owner",
      `/share/options?entityType=track&entityId=${trackId}`
    );
    expect(res.status).toBe(200);
    const options = (await res.json()) as {
      id: number;
      audios: { id: number; version: number; isPrimary: boolean }[];
    }[];

    expect(options).toHaveLength(1);
    expect(options[0]!.id).toBe(trackId);
    // Newest version first, so the default selection is at the top of the list.
    expect(options[0]!.audios.map((audio) => audio.id)).toEqual([
      secondAudio!.id,
      trackAudioId,
    ]);
    expect(options[0]!.audios[1]!.isPrimary).toBe(true);
  });

  it("offers a collection's tracks in their running order", async () => {
    requireProject();
    const collectionId = await mkCollection("Ordered Options");
    const first = await mkSharedTrack("Options Track A");
    const second = await mkSharedTrack("Options Track B");

    for (const [trackNumber, track] of [second, first].entries()) {
      const added = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({
            trackId: track.trackId,
            trackNumber: trackNumber + 1,
          }),
        }
      );
      expect(added.status).toBe(200);
    }

    const res = await request(
      "owner",
      `/share/options?entityType=collection&entityId=${collectionId}`
    );
    expect(res.status).toBe(200);
    const options = (await res.json()) as { id: number; position: number }[];

    expect(options.map((track) => track.id)).toEqual([
      second.trackId,
      first.trackId,
    ]);
    expect(options.map((track) => track.position)).toEqual([1, 2]);
  });

  it("falls back to the live title when a snapshot is given a blank one", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Untitled Snapshot");

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: { title: "", trackAudios: [{ id: trackAudioId }] },
      }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).title).toBe("Untitled Snapshot");
  });

  it("leaves no share link behind when a snapshot names a version the entity does not have", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Refused Snapshot");
    const { trackAudioId: strangerId } = await mkSharedTrack("Somebody Else");

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: {
          title: "Refused",
          trackAudios: [{ id: strangerId }],
        },
      }),
    });
    expect(res.status).toBe(400);

    const left = await db
      .select({ id: sharelinks.id })
      .from(sharelinks)
      .where(
        and(
          eq(sharelinks.entityType, "track"),
          eq(sharelinks.entityId, trackId)
        )
      );
    expect(left).toEqual([]);
  });

  it("keeps showing the title the track had when the snapshot was taken", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Working Title");

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: { title: "", trackAudios: [{ id: trackAudioId }] },
      }),
    });
    expect(res.status).toBe(201);
    const { token } = await res.json();

    const renamed = await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed After Sharing" }),
    });
    expect(renamed.status).toBe(200);

    const read = await request("anonymous", `/share/${token}`);
    expect(read.status).toBe(200);
    const share = await read.json();
    expect(share.title).toBe("Working Title");
    expect(share.tracks[0].title).toBe("Working Title");
  });

  it("keeps serving the cover the track had when the snapshot was taken", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Recovered Art");
    const original = await uploadImage("snapshot-original.jpeg");
    await db
      .update(tracks)
      .set({ image: original.assetPath })
      .where(eq(tracks.id, trackId));

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: {
          title: "Recovered Art",
          trackAudios: [{ id: trackAudioId }],
        },
      }),
    });
    expect(res.status).toBe(201);
    const { token } = await res.json();

    const replacement = await uploadImage("snapshot-replacement.jpeg");
    await db
      .update(tracks)
      .set({ image: replacement.assetPath })
      .where(eq(tracks.id, trackId));

    const read = await request("anonymous", `/share/${token}`);
    expect(read.status).toBe(200);
    const share = await read.json();
    expect(share.tracks[0].artwork.assetPath).toBe(original.assetPath);
  });

  it("shows a guest only their own thread when comments are private", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Private Thread");
    const { token } = await mkShare(trackId, { privateComments: true });
    const guest = await signInAsGuest();
    const otherGuest = await signInAsGuest();

    const post = async (cookie: string, content: string, parentId?: number) => {
      const res = await app.request(`${baseUrl}/share/${token}/comments`, {
        method: "POST",
        headers: cookieHeaders(cookie),
        body: JSON.stringify({ trackAudioId, content, parentId }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).id as number;
    };

    const mine = await post(guest, "Is the bridge too long?");
    await post(owner.cookie, "No, it lands well", mine);
    const theirs = await post(otherGuest, "Someone else's note");
    await post(owner.cookie, "Reply to someone else", theirs);

    const read = await app.request(
      `${baseUrl}/share/${token}/comments?id=${trackAudioId}`,
      { headers: cookieHeaders(guest) }
    );
    expect(read.status).toBe(200);
    const thread = (await read.json()) as {
      id: number;
      replies: { content: string }[];
    }[];

    // Their own comment, with the team's answer to it still attached.
    expect(thread.map((comment) => comment.id)).toEqual([mine]);
    expect(thread[0]!.replies.map((reply) => reply.content)).toEqual([
      "No, it lands well",
    ]);
  });

  it("shows a guest nothing of the track's real name on a renamed snapshot", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Testina Aguilera");

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "track",
        entityId: trackId,
        downloadsEnabled: true,
        snapshotOverrides: {
          title: "The best song ever",
          trackAudios: [{ id: trackAudioId }],
        },
      }),
    });
    expect(res.status).toBe(201);
    const { token } = await res.json();

    const read = await request("anonymous", `/share/${token}`);
    const share = await read.json();
    expect(share.title).toBe("The best song ever");
    // The track a guest is shown carries the chosen name, not its own.
    expect(share.tracks[0].title).toBe("The best song ever");
    // Nor the name the file was uploaded under.
    expect(share.tracks[0].trackAudio.name).toBeUndefined();
    expect(JSON.stringify(share)).not.toContain("Testina Aguilera");

    const download = await request(
      "anonymous",
      `/share/${token}/stream?id=${trackAudioId}&download`
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="The best song ever.jpeg"'
    );
  });

  it("streams a share's audio with range support", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Seekable");
    const { token } = await mkShare(trackId);
    const streamPath = `/share/${token}/stream?id=${trackAudioId}`;

    const full = await request("anonymous", streamPath);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/jpeg");
    expect(full.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const size = (await full.arrayBuffer()).byteLength;

    const ranged = await request("anonymous", streamPath, {
      headers: { Range: "bytes=0-9" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 0-9/${size}`);
    expect((await ranged.arrayBuffer()).byteLength).toBe(10);
  });

  it("names each track of a collection snapshot independently", async () => {
    requireProject();
    const collectionId = await mkCollection("Real Collection Name");
    const first = await mkSharedTrack("Real Track One");
    const second = await mkSharedTrack("Real Track Two");

    for (const [trackNumber, track] of [first, second].entries()) {
      const added = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({
            trackId: track.trackId,
            trackNumber: trackNumber + 1,
          }),
        }
      );
      expect(added.status).toBe(200);
    }

    const res = await request("owner", "/share/snapshot", {
      method: "POST",
      body: JSON.stringify({
        entityType: "collection",
        entityId: collectionId,
        snapshotOverrides: {
          title: "Demos",
          trackAudios: [
            { id: first.trackAudioId, title: "Opener" },
            { id: second.trackAudioId },
          ],
        },
      }),
    });
    expect(res.status).toBe(201);
    const { token } = await res.json();

    const share = await (await request("anonymous", `/share/${token}`)).json();
    // A renamed track takes its new name; one left alone keeps its own, since
    // a collection's title names the release rather than any single track.
    expect(share.tracks.map((t: { title: string }) => t.title)).toEqual([
      "Opener",
      "Real Track Two",
    ]);
  });

  it("has no cover to serve for a track whose hierarchy has none", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Bare Share");
    const { token } = await mkShare(trackId);

    const cover = await request(
      "anonymous",
      `/share/${token}/cover/${trackAudioId}`
    );
    expect(cover.status).toBe(404);
  });
});

describe("share links under the project's sharing policy", () => {
  it("fills an omitted expiry, comment privacy and downloads from the project's defaults", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Defaulted Share");

    const { token } = await withProjectPolicyForTest(
      suite.projectId,
      {
        sharing: {
          shareExpiresDays: 10,
          shareCommentPrivacy: "private",
          shareDownloads: true,
        },
      },
      () => mkShare(trackId)
    );

    const [row] = await db
      .select()
      .from(sharelinks)
      .where(eq(sharelinks.token, token));
    expect(row!.isCommentsPrivate).toBe(true);
    expect(row!.isDownloadsEnabled).toBe(true);
    const lifetime = row!.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(10 * 24 * 60 * 60 * 1000 - 60_000);
    expect(lifetime).toBeLessThanOrEqual(10 * 24 * 60 * 60 * 1000);
  });

  it("keeps the expiry, privacy and downloads a request names", async () => {
    requireProject();
    const { trackId } = await mkSharedTrack("Named Share");
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const { token } = await withProjectPolicyForTest(
      suite.projectId,
      {
        sharing: {
          shareExpiresDays: 10,
          shareCommentPrivacy: "private",
          shareDownloads: true,
        },
      },
      () =>
        mkShare(trackId, {
          expiresAt: expiresAt.toISOString(),
          privateComments: false,
          downloadsEnabled: false,
        })
    );

    const [row] = await db
      .select()
      .from(sharelinks)
      .where(eq(sharelinks.token, token));
    expect(row!.isCommentsPrivate).toBe(false);
    expect(row!.isDownloadsEnabled).toBe(false);
    expect(row!.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("refuses a new comment 403 while guest comments are off, and leaves reading, editing and deleting alone", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Closed Comments");
    const { token } = await mkShare(trackId);
    const guest = await signInAsGuest();
    const post = (content: string) =>
      app.request(`${baseUrl}/share/${token}/comments`, {
        method: "POST",
        headers: cookieHeaders(guest),
        body: JSON.stringify({ trackAudioId, content }),
      });

    const earlier = await post("Written while comments were on");
    expect(earlier.status).toBe(201);
    const comment = (await earlier.json()) as { id: number };

    await withProjectPolicyForTest(
      suite.projectId,
      { sharing: { guestComments: false } },
      async () => {
        const refused = await post("Written after they closed");
        expect(refused.status).toBe(403);

        const thread = await request(
          "anonymous",
          `/share/${token}/comments?id=${trackAudioId}`
        );
        expect(thread.status).toBe(200);
        expect(
          ((await thread.json()) as { id: number }[]).map((c) => c.id)
        ).toEqual([comment.id]);

        const edited = await app.request(
          `${baseUrl}/share/${token}/comments/${comment.id}`,
          {
            method: "PATCH",
            headers: cookieHeaders(guest),
            body: JSON.stringify({ content: "Edited after they closed" }),
          }
        );
        expect(edited.status).toBe(200);

        const removed = await app.request(
          `${baseUrl}/share/${token}/comments/${comment.id}`,
          { method: "DELETE", headers: cookieHeaders(guest) }
        );
        expect(removed.status).toBe(204);
      }
    );
  });
});

describe("share guests and the render fields", () => {
  it("shows a guest neither the pin nor the bounce link of a version", async () => {
    requireProject();
    const { trackId, trackAudioId } = await mkSharedTrack("Guest Fields");
    const { token } = await mkShare(trackId);

    const read = await request("anonymous", `/share/${token}`);
    expect(read.status).toBe(200);
    const share = await read.json();
    const guestSees = share.tracks[0].trackAudio;
    expect(guestSees.id).toBe(trackAudioId);
    expect("primaryPinned" in guestSees).toBe(false);
    expect("bouncedFromSaveId" in guestSees).toBe(false);
  });
});
