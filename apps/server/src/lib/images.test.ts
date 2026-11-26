import { readFile, rm, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ensureVariant,
  isVariantWidth,
  removeVariants,
  variantPath,
  VARIANT_WIDTHS,
} from "./images.js";
import { storedFilePath } from "./storage.js";

/**
 * The functions under test take a stored key, so the fixtures are named as
 * keys and written through `storedFilePath` — into the static root the rest of
 * the server reads them from, rather than a temporary directory of their own.
 */
const imageKey = () => `images/${crypto.randomUUID()}.png`;

describe("isVariantWidth", () => {
  it("accepts only the widths on offer", () => {
    for (const width of VARIANT_WIDTHS)
      expect(isVariantWidth(width)).toBe(true);
    for (const width of [0, 63, 65, 300, 2048, -64, Number.NaN]) {
      expect(isVariantWidth(width)).toBe(false);
    }
  });
});

describe("variantPath", () => {
  it("names a variant from the original's id and the width", () => {
    expect(variantPath("images/abc-123.jpeg", 256)).toBe(
      "./static/images/variants/abc-123-w256.webp"
    );
  });

  it("gives two widths of the same image two paths", () => {
    const original = "images/abc-123.png";
    expect(variantPath(original, 64)).not.toBe(variantPath(original, 1024));
  });
});

describe("ensureVariant", () => {
  const original = imageKey();

  beforeAll(async () => {
    await writeFile(
      storedFilePath(original),
      await sharp({
        create: {
          width: 900,
          height: 600,
          channels: 3,
          background: { r: 40, g: 90, b: 200 },
        },
      })
        .png()
        .toBuffer()
    );
  });

  afterAll(async () => {
    await removeVariants(original);
    await rm(storedFilePath(original), { force: true });
  });

  it("resizes to the requested width and writes webp", async () => {
    const path = await ensureVariant(original, 256);
    expect(path).toBe(variantPath(original, 256));

    const meta = await sharp(path).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
  });

  it("writes a jpeg beside the webp when asked, under its own path", async () => {
    const path = await ensureVariant(original, 256, "jpeg");
    expect(path).toBe(variantPath(original, 256, "jpeg"));
    expect(path).not.toBe(variantPath(original, 256));

    const meta = await sharp(path).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(256);
  });

  it("writes a png beside the webp when asked, under its own path", async () => {
    const path = await ensureVariant(original, 256, "png");
    expect(path).toBe(variantPath(original, 256, "png"));
    expect(path).not.toBe(variantPath(original, 256));

    const meta = await sharp(path).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(256);
  });

  it("leaves an image smaller than the width at its own size", async () => {
    const small = imageKey();
    await writeFile(
      storedFilePath(small),
      await sharp({
        create: {
          width: 40,
          height: 40,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer()
    );

    try {
      const meta = await sharp(await ensureVariant(small, 1024)).metadata();
      expect(meta.width).toBe(40);
    } finally {
      await removeVariants(small);
      await rm(storedFilePath(small), { force: true });
    }
  });

  it("generates a width once, however many callers ask at once", async () => {
    const path = variantPath(original, 64);
    await rm(path, { force: true });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureVariant(original, 64))
    );
    expect(new Set(results)).toEqual(new Set([path]));

    // One generation, so one write: a second call reads the file back rather
    // than encoding it again.
    const { mtimeMs } = await stat(path);
    const bytes = await readFile(path);
    await ensureVariant(original, 64);
    expect((await stat(path)).mtimeMs).toBe(mtimeMs);
    expect(await readFile(path)).toEqual(bytes);
  });
});

describe("removeVariants", () => {
  it("removes every width and tolerates ones that were never generated", async () => {
    const original = imageKey();
    await writeFile(
      storedFilePath(original),
      await sharp({
        create: {
          width: 300,
          height: 300,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer()
    );

    try {
      await ensureVariant(original, 64);
      await ensureVariant(original, 256);
      await ensureVariant(original, 256, "jpeg");

      await removeVariants(original);

      for (const width of VARIANT_WIDTHS) {
        await expect(stat(variantPath(original, width))).rejects.toThrow();
        await expect(
          stat(variantPath(original, width, "jpeg"))
        ).rejects.toThrow();
      }

      await expect(removeVariants(original)).resolves.toBeUndefined();
    } finally {
      await rm(storedFilePath(original), { force: true });
    }
  });
});
