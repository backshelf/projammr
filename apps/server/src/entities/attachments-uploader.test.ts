import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { z } from "zod";
import { assets, attachedAssetSchema } from "../db/schema/assets.js";
import {
  collectionAttachments,
  projectAttachments,
  sessionAttachments,
  trackAttachments,
} from "../db/schema/attachments.js";
import { users } from "../db/schema/auth.js";
import { getCollection } from "./collection/queries.js";
import { getProject } from "./project/queries.js";
import { getSession } from "./session/queries.js";
import { getTrack } from "./track/queries.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("AttachmentsUploader");
const { owner } = suite;

/** Attaches an asset to a project, a collection, a track and a session. */
async function attachEverywhere(assetId: number) {
  const track = await suite.mkTrack("Uploader track");
  const collection = await suite.mkCollection("Uploader collection");
  const session = await suite.mkSession({ name: "Uploader session" });

  await db
    .insert(projectAttachments)
    .values({ projectId: suite.projectId, assetId });
  await db
    .insert(collectionAttachments)
    .values({ collectionId: collection, assetId });
  await db.insert(trackAttachments).values({ trackId: track, assetId });
  await db
    .insert(sessionAttachments)
    .values({ sessionId: session.id, assetId });

  return { track, collection, session };
}

async function readAttachments(ids: {
  track: number;
  collection: number;
  session: { id: number };
}) {
  const [project, collection, track, session] = await Promise.all([
    getProject(suite.projectId),
    getCollection(ids.collection),
    getTrack(ids.track),
    getSession(ids.session.id),
  ]);
  return { project, collection, track, session };
}

/**
 * Each read's attachments, parsed through the schema they must satisfy: a
 * `withArtwork` detail types its other fields loosely.
 */
const attachmentLists = (reads: Awaited<ReturnType<typeof readAttachments>>) =>
  [
    reads.project.attachments,
    reads.collection.attachments,
    reads.track.attachments,
    reads.session.attachments,
  ].map((attachments) => z.array(attachedAssetSchema).parse(attachments));

describe("entity reads carry the attachment's uploader", () => {
  it("reads the uploading user's id, name and image on every entity", async () => {
    suite.requireProject();
    const asset = await suite.uploadAsset("uploader-user.jpeg");
    const ids = await attachEverywhere(asset.id);

    const [user] = await db
      .select({ id: users.id, name: users.name, image: users.image })
      .from(users)
      .where(eq(users.id, owner.userId));
    const reads = await readAttachments(ids);

    for (const attachments of attachmentLists(reads)) {
      expect(attachments[0]?.uploadedBy).toEqual(user!);
    }
    expect(user?.id).toBe(owner.userId);
  });

  it("reads uploadedBy null for an asset with no uploading user", async () => {
    suite.requireProject();
    const asset = await suite.uploadAsset("uploader-none.jpeg");
    await db
      .update(assets)
      .set({ createdByUser: null })
      .where(eq(assets.id, asset.id));
    const ids = await attachEverywhere(asset.id);

    const reads = await readAttachments(ids);

    for (const attachments of attachmentLists(reads)) {
      const row = attachments.find((a) => a.id === asset.id);
      expect(row?.uploadedBy).toBeNull();
    }
  });
});
