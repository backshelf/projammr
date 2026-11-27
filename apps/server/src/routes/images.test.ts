import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import sharp from "sharp";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { afterEach, describe, expect, it } from "bun:test";
import { app } from "../app.js";
import { MAX_PAGE_SIZE } from "../db/queries/pagination.js";
import { VARIANT_WIDTHS, variantPath } from "../lib/images.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { settleJobs } from "../test/media.js";
import {
  baseUrl,
  fakeWav,
  onDiskPath,
  servedAt,
  setParentImage,
  setParentImageRequest,
  setupSuite,
  testImage,
  trustedOrigin,
} from "../test/fixtures.js";

const suite = setupSuite("Images");
const {
  owner,
  viewer,
  outsider,
  requireProject,
  request,
  requestAs,
  expectAccess,
  mkTrack,
  throwawayProject,
  uploadTypedAsset,
  uploadImage,
  uploadAvatar,
} = suite;

const asOwner = (path: string, init?: RequestInit) =>
  request("owner", path, init);
const asEditor = (path: string, init?: RequestInit) =>
  request("editor", path, init);

describe("images", () => {
  it("uploads an image, lists it, and sets and clears its parent", async () => {
    requireProject();
    const image = await uploadImage("test-image.jpeg");
    expect(image.name).toBe("test-image.jpeg");

    expect(existsSync(onDiskPath(image.assetPath))).toBe(true);

    const list = await request("viewer", `/images/project/${suite.projectId}`);
    expect(list.status).toBe(200);
    const listPage = (await list.json()) as { rows: { id: number }[] };
    expect(listPage.rows.some((r) => r.id === image.id)).toBe(true);

    const trackId = await mkTrack("Image Track");
    const setParent = await setParentImage(asOwner, {
      imageId: image.id,
      kind: "track",
      parentId: trackId,
      projectId: suite.projectId,
    });
    expect(setParent.status).toBe(200);

    const clearParent = await request(
      "owner",
      `/images/parent/track/${trackId}`,
      { method: "DELETE" }
    );
    expect(clearParent.status).toBe(204);
    expect(await clearParent.text()).toBe("");
  });

  describe("under the instance's upload policy", () => {
    afterEach(() => {
      restoreInstancePolicy();
    });

    const upload = async (type: string, name: string) => {
      const form = new FormData();
      form.append("file", new File([await testImage()], name, { type }));
      form.append("projectId", String(suite.projectId));
      return app.request(`${baseUrl}/images/upload`, {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: trustedOrigin },
        body: form,
      });
    };

    it("refuses an image type the instance does not take", async () => {
      requireProject();
      stubInstancePolicy({ limits: { imageTypes: ["image/png"] } });

      const res = await upload("image/jpeg", "not-taken-here.jpeg");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: ["file"], code: "invalid_value" }] },
      });
    });

    it("refuses an image over the limit in force", async () => {
      requireProject();
      const size = (await testImage()).byteLength;
      stubInstancePolicy({ limits: { maxUploadMb: (size - 1) / 1024 ** 2 } });

      const res = await upload("image/jpeg", "too-big-here.jpeg");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        details: { issues: [{ code: "too_big", maximum: size - 1 }] },
      });
    });
  });

  it("returns the queued resize job's id for a project image, and null for an avatar", async () => {
    requireProject();
    const image = await uploadImage("returns-variants-job.jpeg");
    expect(Number.isInteger(image.variantsJobId)).toBe(true);

    const avatar = await uploadAvatar("returns-no-variants-job.jpeg");
    expect(avatar.variantsJobId).toBeNull();
  });

  it("lets any project editor set a parent, not just the uploader", async () => {
    requireProject();
    const image = await uploadImage("set-by-editor.jpeg");
    const trackId = await mkTrack("Editor Parent Track");

    // The owner uploaded this image; an editor may still attach it.
    const byEditor = await setParentImage(asEditor, {
      imageId: image.id,
      kind: "track",
      parentId: trackId,
      projectId: suite.projectId,
    });
    expect(byEditor.status).toBe(200);
  });

  it("404s setting an image that does not belong to the project", async () => {
    requireProject();
    const trackId = await mkTrack("Mismatch Track");
    const res = await setParentImage(asOwner, {
      imageId: 99999999,
      kind: "track",
      parentId: trackId,
      projectId: suite.projectId,
    });
    expect(res.status).toBe(404);
  });

  it("gates image endpoints by role", async () => {
    requireProject();
    const image = await uploadImage("gated-image.jpeg");
    const trackId = await mkTrack("Gated Image Track");

    await expectAccess("GET", `/images/project/${suite.projectId}`, {
      viewer: 200,
    });

    const { method, path, body } = setParentImageRequest({
      imageId: image.id,
      kind: "track",
      parentId: trackId,
      projectId: suite.projectId,
    });
    await expectAccess(method, path, { viewer: 403, editor: 200 }, body);

    await expectAccess("DELETE", `/images/parent/track/${trackId}`, {
      viewer: 403,
      editor: 204,
    });
  });

  it("the old path is gone", async () => {
    requireProject();
    const res = await asOwner("/images/set-parent", {
      method: "PATCH",
      body: JSON.stringify({ imageId: 1, kind: "track", parentId: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("imports an image from a public URL into storage with palette and variants, gated by role", async () => {
    requireProject();
    const imgBytes = new Uint8Array(
      await sharp({
        create: {
          width: 48,
          height: 48,
          channels: 3,
          background: { r: 40, g: 120, b: 230 },
        },
      })
        .jpeg()
        .toBuffer()
    );

    const realFetch = globalThis.fetch;
    stubGlobal("fetch", (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://1.1.1.1/imported-cover.jpg") {
        return new Response(imgBytes, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch);

    try {
      const asViewer = await request("viewer", "/images/import", {
        method: "POST",
        body: JSON.stringify({
          url: "https://1.1.1.1/imported-cover.jpg",
          projectId: suite.projectId,
        }),
      });
      expect(asViewer.status).toBe(403);

      const privateUrl = await asEditor("/images/import", {
        method: "POST",
        body: JSON.stringify({
          url: "http://127.0.0.1/nope.jpg",
          projectId: suite.projectId,
        }),
      });
      expect(privateUrl.status).toBe(400);

      const imported = await asEditor("/images/import", {
        method: "POST",
        body: JSON.stringify({
          url: "https://1.1.1.1/imported-cover.jpg",
          projectId: suite.projectId,
        }),
      });
      expect(imported.status).toBe(201);
      const image = (await imported.json()) as {
        id: number;
        name: string;
        assetPath: string;
        accentHue: number | null;
        accentChroma: number | null;
        variantsJobId: number | null;
      };
      expect(image.name).toBe("imported-cover.jpg");
      expect(existsSync(onDiskPath(image.assetPath))).toBe(true);
      expect(image.accentHue).not.toBeNull();
      expect(image.accentChroma).not.toBeNull();
      expect(Number.isInteger(image.variantsJobId)).toBe(true);
    } finally {
      unstubAllGlobals();
    }
  });
});

describe("image variants", () => {
  it("serves a resize as webp and caches it on disk", async () => {
    requireProject();
    const image = await uploadImage("resize-me.jpeg");
    const staticPath = servedAt(image.assetPath);
    const auth = { Cookie: owner.cookie };

    const res = await app.request(`${staticPath}?w=256`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable"
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toMatch(/^"image-\d+-\d+-w256-webp"$/);

    const cached = variantPath(image.assetPath, 256);
    expect(existsSync(cached)).toBe(true);
    const bytes = await res.arrayBuffer();
    // "RIFF....WEBP" — the resize really was re-encoded, not passed through.
    expect(Buffer.from(bytes.slice(8, 12)).toString()).toBe("WEBP");

    // A width is generated once: the second request must not rewrite the file.
    const { mtimeMs } = await stat(cached);
    const again = await app.request(`${staticPath}?w=256`, { headers: auth });
    expect(again.status).toBe(200);
    await again.arrayBuffer();
    expect((await stat(cached)).mtimeMs).toBe(mtimeMs);
  });

  it("gives a variant its own ETag and honours it", async () => {
    requireProject();
    const image = await uploadImage("etagged.jpeg");
    const staticPath = servedAt(image.assetPath);
    const auth = { Cookie: owner.cookie };

    const original = await app.request(staticPath, { headers: auth });
    const variant = await app.request(`${staticPath}?w=64`, { headers: auth });
    const originalTag = original.headers.get("etag")!;
    const variantTag = variant.headers.get("etag")!;
    expect(variantTag).not.toBe(originalTag);
    await variant.arrayBuffer();

    const repeat = await app.request(`${staticPath}?w=64`, {
      headers: { ...auth, "If-None-Match": variantTag },
    });
    expect(repeat.status).toBe(304);

    // The original's tag says nothing about the 64px picture.
    const mismatched = await app.request(`${staticPath}?w=64`, {
      headers: { ...auth, "If-None-Match": originalTag },
    });
    expect(mismatched.status).toBe(200);
    await mismatched.arrayBuffer();
  });

  it("serves a resize as png when asked, with its own ETag", async () => {
    requireProject();
    const image = await uploadImage("png-me.jpeg");
    const staticPath = servedAt(image.assetPath);
    const auth = { Cookie: owner.cookie };

    const webp = await app.request(`${staticPath}?w=64`, { headers: auth });
    const png = await app.request(`${staticPath}?w=64&format=png`, {
      headers: auth,
    });
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("etag")).toMatch(/^"image-\d+-\d+-w64-png"$/);
    expect(png.headers.get("etag")).not.toBe(webp.headers.get("etag"));
    await webp.arrayBuffer();

    const bytes = Buffer.from(await png.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("png");
  });

  it("refuses a format that is not on offer", async () => {
    requireProject();
    const image = await uploadImage("bad-format.jpeg");
    const auth = { Cookie: owner.cookie };

    const res = await app.request(
      `${servedAt(image.assetPath)}?w=64&format=avif`,
      { headers: auth }
    );
    expect(res.status).toBe(400);
  });

  it("ignores ?format= on a request for the original", async () => {
    requireProject();
    const image = await uploadImage("format-ignored.jpeg");
    const auth = { Cookie: owner.cookie };

    const res = await app.request(`${servedAt(image.assetPath)}?format=png`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("refuses a width that is not on offer, and any width on a non-image", async () => {
    requireProject();
    const image = await uploadImage("fixed-widths.jpeg");
    const auth = { Cookie: owner.cookie };

    const odd = await app.request(`${servedAt(image.assetPath)}?w=300`, {
      headers: auth,
    });
    expect(odd.status).toBe(400);

    const nonsense = await app.request(`${servedAt(image.assetPath)}?w=abc`, {
      headers: auth,
    });
    expect(nonsense.status).toBe(400);

    const asset = await uploadTypedAsset("song.wav", "audio/wav", fakeWav);
    const audio = await app.request(`${servedAt(asset.assetPath)}?w=64`, {
      headers: auth,
    });
    expect(audio.status).toBe(400);
  });

  it("gates a variant exactly as it gates the original", async () => {
    requireProject();
    const image = await uploadImage("still-private.jpeg");
    const staticPath = `${servedAt(image.assetPath)}?w=64`;

    const anon = await app.request(staticPath);
    expect(anon.status).toBe(401);

    const stranger = await app.request(staticPath, {
      headers: { Cookie: outsider.cookie },
    });
    expect(stranger.status).toBe(403);

    const member = await app.request(staticPath, {
      headers: { Cookie: viewer.cookie },
    });
    expect(member.status).toBe(200);
    await member.arrayBuffer();
  });

  it("serves a cached variant to nobody without a row of its own", async () => {
    requireProject();
    const image = await uploadImage("no-back-door.jpeg");
    const auth = { Cookie: owner.cookie };

    const primed = await app.request(`${servedAt(image.assetPath)}?w=64`, {
      headers: auth,
    });
    expect(primed.status).toBe(200);
    await primed.arrayBuffer();

    // The variants directory sits inside ./static, and nothing points a row at
    // it, so the fail-closed rule covers it like any other orphan.
    const direct = await app.request(
      servedAt(variantPath(image.assetPath, 64).replace("./static/", "")),
      { headers: auth }
    );
    expect(direct.status).toBe(404);
  });

  it("pre-generates every width when a project image is uploaded", async () => {
    requireProject();
    const image = await uploadImage("pre-generated.jpeg");

    await settleJobs([image.variantsJobId!]);

    for (const width of VARIANT_WIDTHS) {
      expect(existsSync(variantPath(image.assetPath, width))).toBe(true);
    }
  });

  it("takes an image's variants with it when its project is deleted", async () => {
    requireProject();

    const created = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Variant Project ${Date.now()}`,
        description: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Deleted by this test to prove its variants go with it",
              },
            ],
          },
        ],
        links: [],
      }),
    });
    expect(created.status).toBe(201);
    const doomedId = (await created.json()).id as number;

    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], "variants-go-too.jpeg", {
        type: "image/jpeg",
      })
    );
    form.append("projectId", String(doomedId));
    const uploaded = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const image = (await uploaded.json()) as {
      assetPath: string;
      variantsJobId: number;
    };

    await settleJobs([image.variantsJobId]);

    const cached = VARIANT_WIDTHS.map((width) =>
      variantPath(image.assetPath, width)
    );
    expect(cached.every(existsSync)).toBe(true);

    const deleted = await request("owner", `/projects/${doomedId}`, {
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);

    expect(cached.some(existsSync)).toBe(false);
  });
});

type ImagesPage = {
  rows: { id: number }[];
  rowCount: number;
  page: number;
  pageSize: number;
};

describe("paged project listing", () => {
  it("pages a project's images and reports the total", async () => {
    // A throwaway project keeps this listing free of the images the other
    // tests in this file upload into the suite's shared project.
    const paging = await throwawayProject("Paging");

    async function upload(name: string) {
      const form = new FormData();
      form.append(
        "file",
        new File([await testImage()], name, { type: "image/jpeg" })
      );
      form.append("projectId", String(paging.id));
      const res = await app.request(`${baseUrl}/images/upload`, {
        method: "POST",
        headers: { Cookie: paging.owner.cookie, Origin: trustedOrigin },
        body: form,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: number }).id;
    }

    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await upload(`paging-set-${i}.jpeg`));
    }

    const first = await requestAs(
      paging.owner,
      `/images/project/${paging.id}?pageSize=2`
    );
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as ImagesPage;
    expect(firstPage.page).toBe(1);
    expect(firstPage.pageSize).toBe(2);
    expect(firstPage.rowCount).toBe(ids.length);
    expect(firstPage.rows.map((r) => r.id)).toEqual(ids.slice(0, 2));

    const second = await requestAs(
      paging.owner,
      `/images/project/${paging.id}?page=2&pageSize=2`
    );
    const secondPage = (await second.json()) as ImagesPage;
    expect(secondPage.rows.map((r) => r.id)).toEqual(ids.slice(2));

    const pastTheEnd = await requestAs(
      paging.owner,
      `/images/project/${paging.id}?page=9999&pageSize=25`
    );
    expect(pastTheEnd.status).toBe(200);
    const pastTheEndPage = (await pastTheEnd.json()) as ImagesPage;
    expect(pastTheEndPage.rows).toEqual([]);
    expect(pastTheEndPage.rowCount).toBe(ids.length);
  });

  it("clamps a pageSize over the maximum instead of rejecting it", async () => {
    requireProject();
    const tooLarge = await request(
      "viewer",
      `/images/project/${suite.projectId}?pageSize=500`
    );
    expect(tooLarge.status).toBe(200);
    const tooLargePage = (await tooLarge.json()) as ImagesPage;
    expect(tooLargePage.pageSize).toBe(MAX_PAGE_SIZE);

    const zeroPage = await request(
      "viewer",
      `/images/project/${suite.projectId}?page=0`
    );
    expect(zeroPage.status).toBe(400);
  });
});
