import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../src/db/index.js";
import { collections } from "../src/db/schema/collections.js";
import { projects } from "../src/db/schema/projects.js";
import { setupSuite } from "../src/test/fixtures.js";
import { ingestExternalImages } from "./ingest-external-images.js";

const suite = setupSuite("ingest-external-images script");

async function vividPng(): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 30, g: 180, b: 120 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("ingestExternalImages", () => {
  it("ingests shared external URLs once per project and populates artwork", async () => {
    suite.requireProject();
    const project = await suite.throwawayProject("External Covers");
    const createdCol = await suite.requestAs(project.owner, "/collections", {
      method: "POST",
      body: JSON.stringify({
        title: "Shared Cover Album",
        projectId: project.id,
      }),
    });
    expect(createdCol.status).toBe(201);
    const collectionId = ((await createdCol.json()) as { id: number }).id;

    const sharedUrl = `https://example.test/cover-${project.id}.png`;
    await db
      .update(projects)
      .set({ image: sharedUrl })
      .where(eq(projects.id, project.id));
    await db
      .update(collections)
      .set({ image: sharedUrl })
      .where(eq(collections.id, collectionId));

    let fetchedCount = 0;
    const png = await vividPng();
    const report = await ingestExternalImages({
      fetchImage: async (url) => {
        if (url === sharedUrl) fetchedCount++;
        return {
          kind: "bytes",
          bytes: png,
          name: "cover.png",
          type: "image/png",
        };
      },
    });

    expect(fetchedCount).toBe(1);
    expect(report.failed).toEqual([]);
    expect(report.updatedEntities).toBeGreaterThanOrEqual(2);

    const colRes = await suite.requestAs(
      project.owner,
      `/collections/${collectionId}`
    );
    expect(colRes.status).toBe(200);
    const col = (await colRes.json()) as {
      image: string | null;
      artwork: {
        assetPath: string;
        accentHue: number | null;
        accentChroma: number | null;
      } | null;
    };
    expect(col.image).toMatch(/^images\/.+\.png$/);
    expect(col.artwork).not.toBeNull();
    expect(col.artwork?.assetPath).toBe(col.image!);
    expect(col.artwork?.accentHue).not.toBeNull();

    const projRes = await suite.requestAs(
      project.owner,
      `/projects/${project.id}`
    );
    const proj = (await projRes.json()) as {
      image: string | null;
      artwork: { assetPath: string } | null;
    };
    expect(proj.image).toBe(col.image);
    expect(proj.artwork?.assetPath).toBe(col.image!);
  });
});
