import { existsSync } from "node:fs";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { app } from "./app.js";
import { db } from "./db/index.js";
import { images } from "./db/schema/images.js";
import {
  baseUrl,
  fakeWav,
  onDiskPath,
  servedAt,
  setupSuite,
  testImage,
  trustedOrigin,
} from "./test/fixtures.js";

const suite = setupSuite("Static");
const {
  owner,
  viewer,
  outsider,
  requireProject,
  request,
  uploadAsset,
  uploadTypedAsset,
  uploadAvatar,
  uploadImage,
} = suite;

describe("static files", () => {
  it("serves an asset inline with its real MIME type and honours range requests", async () => {
    requireProject();
    const asset = await uploadAsset("stream-me.jpeg");
    const staticPath = servedAt(asset.assetPath);
    const auth = { Cookie: owner.cookie };

    const full = await app.request(staticPath, { headers: auth });
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/jpeg");
    expect(full.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("cache-control")).toBe("private, max-age=3600");
    const body = await full.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(200);

    const ranged = await app.request(staticPath, {
      headers: { ...auth, Range: "bytes=0-99" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(
      `bytes 0-99/${body.byteLength}`
    );
    expect(ranged.headers.get("accept-ranges")).toBe("bytes");
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);

    const download = await app.request(`${staticPath}?download=1`, {
      headers: auth,
    });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("answers open-ended, suffix and out-of-bounds ranges", async () => {
    requireProject();
    const asset = await uploadAsset("ranges.jpeg");
    const staticPath = servedAt(asset.assetPath);
    const auth = { Cookie: owner.cookie };
    const size = (
      await (await app.request(staticPath, { headers: auth })).arrayBuffer()
    ).byteLength;

    const tail = await app.request(staticPath, {
      headers: { ...auth, Range: `bytes=${size - 10}-` },
    });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe(
      `bytes ${size - 10}-${size - 1}/${size}`
    );
    expect((await tail.arrayBuffer()).byteLength).toBe(10);

    const suffix = await app.request(staticPath, {
      headers: { ...auth, Range: "bytes=-20" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe(
      `bytes ${size - 20}-${size - 1}/${size}`
    );

    const past = await app.request(staticPath, {
      headers: { ...auth, Range: `bytes=${size}-` },
    });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe(`bytes */${size}`);
  });

  it("gates a project's uploaded files on membership", async () => {
    requireProject();
    const asset = await uploadAsset("private.jpeg");
    const staticPath = servedAt(asset.assetPath);

    const anon = await app.request(staticPath);
    expect(anon.status).toBe(401);

    const stranger = await app.request(staticPath, {
      headers: { Cookie: outsider.cookie },
    });
    expect(stranger.status).toBe(403);

    // A viewer may read the file even though they cannot write to the project.
    const member = await app.request(staticPath, {
      headers: { Cookie: viewer.cookie },
    });
    expect(member.status).toBe(200);
  });

  it("refuses a file that no row points at, however it reached the disk", async () => {
    requireProject();
    const stray = `assets/${crypto.randomUUID()}.jpeg`;
    await writeFile(onDiskPath(stray), await testImage());

    try {
      const staticPath = servedAt(stray);

      const anon = await app.request(staticPath);
      expect(anon.status).toBe(404);

      const member = await app.request(staticPath, {
        headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      });
      expect(member.status).toBe(404);
    } finally {
      await unlink(onDiskPath(stray));
    }
  });

  it("hands over anything that is not audio or an image as opaque bytes", async () => {
    requireProject();
    const asset = await uploadTypedAsset(
      "payload.html",
      "text/html",
      "<script>document.title = 'xss'</script>"
    );

    const res = await app.request(servedAt(asset.assetPath), {
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
    });
    expect(res.status).toBe(200);
    // Never `text/html`: the API origin is where the session cookie lives.
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves audio inline under its stored type until asked to download it", async () => {
    requireProject();
    const asset = await uploadTypedAsset("clip.wav", "audio/wav", fakeWav);
    const staticPath = servedAt(asset.assetPath);
    const auth = { Cookie: owner.cookie };

    const inline = await app.request(staticPath, { headers: auth });
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toBe("audio/wav");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);

    const download = await app.request(`${staticPath}?download`, {
      headers: auth,
    });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("serves an avatar to any signed-in user but not to an anonymous one", async () => {
    requireProject();
    const avatar = await uploadAvatar("face.jpeg");
    expect(avatar.scope).toBe("user");
    const staticPath = servedAt(avatar.assetPath);

    const anon = await app.request(staticPath);
    expect(anon.status).toBe(401);

    // An avatar appears wherever its owner does, including to users who share
    // no project with them.
    const stranger = await app.request(staticPath, {
      headers: { Cookie: outsider.cookie },
    });
    expect(stranger.status).toBe(200);
    expect(stranger.headers.get("content-disposition")).toMatch(/^inline;/);

    // An avatar belongs to no project, so no project delete reaps it.
    await db.delete(images).where(eq(images.id, avatar.id));
    await unlink(onDiskPath(avatar.assetPath));
  });

  it("unlinks an asset's bytes when its row is deleted", async () => {
    requireProject();
    const asset = await uploadAsset("delete-me.jpeg");
    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);

    const deleted = await request("owner", `/assets/${asset.id}`, {
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);

    expect(existsSync(onDiskPath(asset.assetPath))).toBe(false);
    const served = await app.request(servedAt(asset.assetPath), {
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
    });
    expect(served.status).toBe(404);
  });

  it("unlinks an image's bytes when its row is deleted", async () => {
    requireProject();
    const image = await uploadImage("delete-me.jpeg");
    expect(existsSync(onDiskPath(image.assetPath))).toBe(true);

    const deleted = await request("owner", `/images/${image.id}`, {
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);

    expect(existsSync(onDiskPath(image.assetPath))).toBe(false);
    const served = await app.request(servedAt(image.assetPath), {
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
    });
    expect(served.status).toBe(404);
  });

  it("unlinks every file a project owns when the project is deleted", async () => {
    requireProject();

    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Doomed Project ${Date.now()}`,
        description: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Deleted by this test to prove its files go with it",
              },
            ],
          },
        ],
        links: [],
      }),
    });
    expect(created.status).toBe(201);
    const doomedId = (await created.json()).id as number;

    const asset = await uploadTypedAsset(
      "doomed.jpeg",
      "image/jpeg",
      await testImage(),
      owner.cookie,
      doomedId
    );

    const imageForm = new FormData();
    imageForm.append(
      "file",
      new File([await testImage()], "doomed-art.jpeg", { type: "image/jpeg" })
    );
    imageForm.append("projectId", String(doomedId));
    const imageRes = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: imageForm,
    });
    expect(imageRes.status).toBe(201);
    const image = (await imageRes.json()) as { assetPath: string };

    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);
    expect(existsSync(onDiskPath(image.assetPath))).toBe(true);

    const deleted = await request("owner", `/projects/${doomedId}`, {
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);

    expect(existsSync(onDiskPath(asset.assetPath))).toBe(false);
    expect(existsSync(onDiskPath(image.assetPath))).toBe(false);
  });

  it("creates no row when the upload cannot be written", async () => {
    requireProject();

    const before = await request("owner", `/assets/project/${suite.projectId}`);
    const countBefore = ((await before.json()) as { rowCount: number })
      .rowCount;

    // Read-and-execute only, so the write fails with EACCES. A run as root
    // would write anyway and fail this test rather than silently pass it.
    await chmod("./static/assets", 0o500);
    try {
      const form = new FormData();
      form.append(
        "file",
        new File([await testImage()], "unwritable.jpeg", {
          type: "image/jpeg",
        })
      );
      form.append("projectId", String(suite.projectId));

      const res = await app.request(`${baseUrl}/assets/upload`, {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: trustedOrigin },
        body: form,
      });
      expect(res.status).toBe(500);
    } finally {
      await chmod("./static/assets", 0o755);
    }

    const after = await request("owner", `/assets/project/${suite.projectId}`);
    expect(((await after.json()) as { rowCount: number }).rowCount).toBe(
      countBefore
    );
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    requireProject();
    const asset = await uploadAsset("cache-me.jpeg");
    const staticPath = servedAt(asset.assetPath);
    const auth = { Cookie: owner.cookie };

    const first = await app.request(staticPath, { headers: auth });
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"asset-\d+-\d+"$/);

    const repeat = await app.request(staticPath, {
      headers: { ...auth, "If-None-Match": etag! },
    });
    expect(repeat.status).toBe(304);
    expect(repeat.headers.get("etag")).toBe(etag);
    expect(repeat.headers.get("cache-control")).toBe("private, max-age=3600");
    expect((await repeat.arrayBuffer()).byteLength).toBe(0);

    // A tag from some other file is not this file's, so the bytes come back.
    const stale = await app.request(staticPath, {
      headers: { ...auth, "If-None-Match": '"asset-0-0"' },
    });
    expect(stale.status).toBe(200);
  });

  it("refuses an outsider holding a valid If-None-Match", async () => {
    requireProject();
    const asset = await uploadAsset("not-yours.jpeg");
    const staticPath = servedAt(asset.assetPath);

    const mine = await app.request(staticPath, {
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
    });
    const etag = mine.headers.get("etag")!;

    // The tag is a fact about the row, not a capability: the gate runs first.
    const stranger = await app.request(staticPath, {
      headers: { Cookie: outsider.cookie, "If-None-Match": etag },
    });
    expect(stranger.status).toBe(403);

    const anon = await app.request(staticPath, {
      headers: { "If-None-Match": etag },
    });
    expect(anon.status).toBe(401);
  });
});
