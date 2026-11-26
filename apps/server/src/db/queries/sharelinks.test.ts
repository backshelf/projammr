import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ApiError } from "../../lib/http.js";
import { signUpAndSignIn, type Actor } from "../../test/fixtures.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { comments } from "../schema/comments.js";
import { images } from "../schema/images.js";
import { members, projects } from "../schema/projects.js";
import {
  sharelinks,
  sharelinkSnapshotTrackAudios,
} from "../schema/sharelinks.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import {
  convertSharelink,
  createShareComment,
  createSharelink,
  deleteShareComment,
  getShareComments,
  getSharelink,
  resolveSharelinkTrackAudio,
  revokeSharelink,
  updateShareComment,
  updateSharelink,
} from "./sharelinks.js";

let projectId: number;
let priorityId: number;
let trackId: number;
let secondTrackAudioId: number;
let primaryTrackAudioId: number;
let editor: Actor;
let viewer: Actor;
let outsider: Actor;

async function makeAudio(name: string, isPrimary: boolean, version: number) {
  const [asset] = await db
    .insert(assets)
    .values({
      name,
      type: "audio/wav",
      size: 1,
      assetPath: `x/${name}`,
      projectId,
    })
    .returning({ id: assets.id });
  const [audio] = await db
    .insert(trackAudios)
    .values({ trackId, assetId: asset!.id, version, isPrimary })
    .returning({ id: trackAudios.id });
  return audio!.id;
}

async function status(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (error) {
    if (error instanceof HTTPException) return error.status;
    throw error;
  }
}

beforeAll(async () => {
  const [project] = await db
    .insert(projects)
    .values({ name: `Sharelinks Test ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  priorityId = await seedScale(projectId);

  editor = await signUpAndSignIn("Sharelinks Editor");
  viewer = await signUpAndSignIn("Sharelinks Viewer");
  outsider = await signUpAndSignIn("Sharelinks Outsider");
  await db.insert(members).values([
    { projectId, userId: editor.userId, role: "editor" },
    { projectId, userId: viewer.userId, role: "viewer" },
  ]);

  const [track] = await db
    .insert(tracks)
    .values({ title: "Shared Track", artists: [], projectId, priorityId })
    .returning({ id: tracks.id });
  trackId = track!.id;

  primaryTrackAudioId = await makeAudio("primary.wav", true, 1);
  secondTrackAudioId = await makeAudio("alt-take.wav", false, 2);
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("createSharelink", () => {
  it("lets an editor create a connected share", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    expect(link.shareType).toBe("connected");
    expect(link.tracks).toHaveLength(1);
    expect(link.tracks[0]!.trackAudio.id).toBe(primaryTrackAudioId);
  });

  it("refuses a viewer and an outsider", async () => {
    expect(
      await status(() =>
        createSharelink(
          "connected",
          { entityType: "track", entityId: trackId },
          viewer.userId
        )
      )
    ).toBe(403);
    expect(
      await status(() =>
        createSharelink(
          "connected",
          { entityType: "track", entityId: trackId },
          outsider.userId
        )
      )
    ).toBe(403);
  });

  it("can snapshot a specific non-primary version by override", async () => {
    const link = await createSharelink(
      "snapshot",
      {
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: {
          title: "An Alt Take",
          trackAudios: [{ id: secondTrackAudioId }],
        },
      },
      editor.userId
    );
    expect(link.title).toBe("An Alt Take");
    expect(link.tracks).toHaveLength(1);
    expect(link.tracks[0]!.trackAudio.id).toBe(secondTrackAudioId);
  });

  it("rejects a track audio override that is not part of the entity", async () => {
    const foreignAudioId = await (async () => {
      const [otherTrack] = await db
        .insert(tracks)
        .values({ title: "Unrelated", artists: [], projectId, priorityId })
        .returning({ id: tracks.id });
      const [asset] = await db
        .insert(assets)
        .values({
          name: "other.wav",
          type: "audio/wav",
          size: 1,
          assetPath: "x/other.wav",
          projectId,
        })
        .returning({ id: assets.id });
      const [audio] = await db
        .insert(trackAudios)
        .values({
          trackId: otherTrack!.id,
          assetId: asset!.id,
          version: 1,
          isPrimary: true,
        })
        .returning({ id: trackAudios.id });
      return audio!.id;
    })();

    expect(
      await status(() =>
        createSharelink(
          "snapshot",
          {
            entityType: "track",
            entityId: trackId,
            snapshotOverrides: {
              title: "Bad",
              trackAudios: [{ id: foreignAudioId }],
            },
          },
          editor.userId
        )
      )
    ).toBe(400);
  });

  it("defaults to a far-future expiry that does not immediately 410", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    expect(link.expiresAt.getFullYear()).toBeGreaterThan(9000);

    const fetched = await getSharelink(link.token);
    expect(fetched.token).toBe(link.token);
  });
});

describe("expiry", () => {
  it("410s a guest read past expiresAt, but lets an editor still manage it", async () => {
    const link = await createSharelink(
      "connected",
      {
        entityType: "track",
        entityId: trackId,
        expiresAt: new Date(Date.now() - 1000),
      },
      editor.userId
    );

    expect(await status(() => getSharelink(link.token))).toBe(410);

    const extended = await updateSharelink(link.token, editor.userId, {
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(extended.token).toBe(link.token);

    // Now that it is extended, a guest read succeeds again.
    const fetched = await getSharelink(link.token);
    expect(fetched.token).toBe(link.token);
  });
});

describe("convertSharelink", () => {
  it("freezes a connected link into a snapshot and back", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );

    const asSnapshot = await convertSharelink(link.token, editor.userId, {
      shareType: "snapshot",
    });
    expect(asSnapshot.shareType).toBe("snapshot");
    expect(asSnapshot.tracks).toHaveLength(1);

    const rows = await db
      .select()
      .from(sharelinkSnapshotTrackAudios)
      .where(eq(sharelinkSnapshotTrackAudios.sharelinkId, asSnapshot.id));
    expect(rows).toHaveLength(1);

    const backToConnected = await convertSharelink(link.token, editor.userId, {
      shareType: "connected",
    });
    expect(backToConnected.shareType).toBe("connected");

    const rowsAfter = await db
      .select()
      .from(sharelinkSnapshotTrackAudios)
      .where(eq(sharelinkSnapshotTrackAudios.sharelinkId, asSnapshot.id));
    expect(rowsAfter).toHaveLength(0);
  });
});

describe("resolveSharelinkTrackAudio", () => {
  it("grants the shared track audio and rejects any other id", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );

    const { track } = await resolveSharelinkTrackAudio(
      link.token,
      primaryTrackAudioId
    );
    expect(track.trackAudio.id).toBe(primaryTrackAudioId);

    expect(
      await status(() =>
        resolveSharelinkTrackAudio(link.token, secondTrackAudioId)
      )
    ).toBe(404);
  });
});

describe("guest comments", () => {
  it("shows all comments when comments are not private", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId, privateComments: false },
      editor.userId
    );
    const guest = await signUpAndSignIn("Sharelinks Guest A");
    const otherGuest = await signUpAndSignIn("Sharelinks Guest B");

    await createShareComment(link.token, guest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Sounds great!",
    });
    await createShareComment(link.token, otherGuest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Agreed!",
    });

    const seenByOtherGuest = await getShareComments(
      link.token,
      primaryTrackAudioId,
      otherGuest.userId
    );
    expect(seenByOtherGuest.map((c) => c.content).sort()).toEqual(
      ["Agreed!", "Sounds great!"].sort()
    );
  });

  it("narrows a private thread to the guest's own comments and their replies", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId, privateComments: true },
      editor.userId
    );
    const guestA = await signUpAndSignIn("Sharelinks Guest C");
    const guestB = await signUpAndSignIn("Sharelinks Guest D");

    const fromGuestA = await createShareComment(link.token, guestA.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "From guest A",
    });
    await createShareComment(link.token, editor.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "From the team",
    });
    await createShareComment(link.token, editor.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Answer for guest A",
      parentId: fromGuestA.id,
    });

    // A guest who has said nothing has no thread of their own to read, not
    // even the team's own comments.
    const seenByGuestB = await getShareComments(
      link.token,
      primaryTrackAudioId,
      guestB.userId
    );
    expect(seenByGuestB).toEqual([]);

    // Guest A sees what they wrote, and the team's answer hanging off it.
    const seenByGuestA = await getShareComments(
      link.token,
      primaryTrackAudioId,
      guestA.userId
    );
    expect(seenByGuestA.map((c) => c.content)).toEqual(["From guest A"]);
    expect(seenByGuestA[0]!.replies.map((r) => r.content)).toEqual([
      "Answer for guest A",
    ]);
  });

  it("refuses a comment on a track audio the share does not grant", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    const guest = await signUpAndSignIn("Sharelinks Guest E");

    expect(
      await status(() =>
        createShareComment(link.token, guest.userId, {
          trackAudioId: secondTrackAudioId,
          content: "Should not land",
        })
      )
    ).toBe(404);
  });
});

describe("revokeSharelink", () => {
  it("stamps the link so the guest gate throws 410 revoked", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    await revokeSharelink(link.token, editor.userId);

    const [row] = await db
      .select({ revokedAt: sharelinks.revokedAt })
      .from(sharelinks)
      .where(eq(sharelinks.token, link.token));
    expect(row!.revokedAt).toBeInstanceOf(Date);

    const error = await getSharelink(link.token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(410);
    expect((error as ApiError).code).toBe("revoked");
  });

  it("reports revoked, not expired, for a link that is both", async () => {
    const link = await createSharelink(
      "connected",
      {
        entityType: "track",
        entityId: trackId,
        expiresAt: new Date("2020-01-01"),
      },
      editor.userId
    );
    await revokeSharelink(link.token, editor.userId);

    const error = await getSharelink(link.token).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("revoked");
  });

  it("leaves the first timestamp when revoked again", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    await revokeSharelink(link.token, editor.userId);
    const [first] = await db
      .select({ revokedAt: sharelinks.revokedAt })
      .from(sharelinks)
      .where(eq(sharelinks.token, link.token));

    await revokeSharelink(link.token, editor.userId);
    const [second] = await db
      .select({ revokedAt: sharelinks.revokedAt })
      .from(sharelinks)
      .where(eq(sharelinks.token, link.token));

    expect(second!.revokedAt).toEqual(first!.revokedAt!);
  });

  it("keeps the comments written through the link", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    const guest = await signUpAndSignIn("Sharelinks Guest Revoke");
    const comment = await createShareComment(link.token, guest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Written before the revoke",
    });
    await revokeSharelink(link.token, editor.userId);

    const [row] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.id, comment.id));
    expect(row).toBeDefined();
  });

  it("refuses a viewer", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    expect(await status(() => revokeSharelink(link.token, viewer.userId))).toBe(
      403
    );
  });
});

describe("sharelinks in a collection", () => {
  it("shares every track in the collection", async () => {
    const [collection] = await db
      .insert(collections)
      .values({ title: "Shared Collection", projectId, priorityId })
      .returning({ id: collections.id });
    await db
      .insert(collectionTracks)
      .values({ collectionId: collection!.id, trackId, trackNumber: 1 });

    const link = await createSharelink(
      "connected",
      { entityType: "collection", entityId: collection!.id },
      editor.userId
    );
    expect(link.tracks).toHaveLength(1);
    expect(link.tracks[0]!.trackAudio.id).toBe(primaryTrackAudioId);
  });
});

describe("amending a guest comment", () => {
  it("lets a guest reply to, edit and delete their own comment", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    const guest = await signUpAndSignIn("Sharelinks Guest E");

    const comment = await createShareComment(link.token, guest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "The bass is loud",
      positionMs: 12_000,
    });
    expect(comment.positionMs).toBe(12_000);

    const reply = await createShareComment(link.token, guest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Actually it's fine",
      parentId: comment.id,
    });
    expect(reply.parentId).toBe(comment.id);

    const edited = await updateShareComment(
      link.token,
      guest.userId,
      comment.id,
      { content: "The bass is a touch loud" }
    );
    expect(edited.content).toBe("The bass is a touch loud");

    await deleteShareComment(link.token, guest.userId, comment.id);
    const thread = await getShareComments(
      link.token,
      primaryTrackAudioId,
      guest.userId
    );
    expect(thread.some((c) => c.id === comment.id)).toBe(false);
  });

  it("refuses to amend someone else's comment", async () => {
    const link = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    const author = await signUpAndSignIn("Sharelinks Guest F");
    const bystander = await signUpAndSignIn("Sharelinks Guest G");

    const comment = await createShareComment(link.token, author.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "Mine",
    });

    expect(
      await status(() =>
        updateShareComment(link.token, bystander.userId, comment.id, {
          content: "Not yours",
        })
      )
    ).toBe(403);
    expect(
      await status(() =>
        deleteShareComment(link.token, bystander.userId, comment.id)
      )
    ).toBe(403);
  });

  it("refuses a comment the link does not grant", async () => {
    const granting = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    const guest = await signUpAndSignIn("Sharelinks Guest H");
    const comment = await createShareComment(granting.token, guest.userId, {
      trackAudioId: primaryTrackAudioId,
      content: "On the primary",
    });

    // A snapshot frozen onto the other version grants nothing this comment
    // hangs off, so holding it must not reach the thread.
    const elsewhere = await createSharelink(
      "snapshot",
      {
        entityType: "track",
        entityId: trackId,
        snapshotOverrides: {
          title: "Alt take only",
          trackAudios: [{ id: secondTrackAudioId }],
        },
      },
      editor.userId
    );

    expect(
      await status(() =>
        updateShareComment(elsewhere.token, guest.userId, comment.id, {
          content: "Reaching",
        })
      )
    ).toBe(404);
  });
});

describe("shared artwork", () => {
  it("resolves each track's cover through the project fallback", async () => {
    const [image] = await db
      .insert(images)
      .values({
        name: "cover.png",
        type: "image/png",
        size: 1,
        assetPath: `images/share-test-${Date.now()}.png`,
        projectId,
        accentHue: 210,
        accentChroma: 0.09,
      })
      .returning({ assetPath: images.assetPath });
    await db
      .update(projects)
      .set({ image: image!.assetPath })
      .where(eq(projects.id, projectId));

    const connected = await createSharelink(
      "connected",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    expect(connected.tracks[0]!.artwork).toEqual({
      assetPath: image!.assetPath,
      accentHue: 210,
      accentChroma: 0.09,
    });

    const snapshot = await createSharelink(
      "snapshot",
      { entityType: "track", entityId: trackId },
      editor.userId
    );
    expect(snapshot.tracks[0]!.artwork?.assetPath).toBe(image!.assetPath);
  });
});
