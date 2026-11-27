/**
 * One-off backfill: ingests external `http(s)://` URLs stored directly on
 * `projects.image`, `collections.image`, or `tracks.image` into Projammr's
 * configured storage backend, extracting accent palettes, creating `images`
 * rows, updating parent rows, and queueing resize variants.
 *
 * Shared URLs within the same project are fetched and stored once, then pinned
 * to every entity in that project that referenced them.
 *
 * Usage:
 *   bun scripts/ingest-external-images.ts [--dry-run]
 *   docker compose exec api bun dist/scripts/ingest-external-images.js [--dry-run]
 */
import "dotenv/config";
import { type Column, and, asc, eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../src/db/index.js";
import { ingestImage, setImageOnParent } from "../src/db/queries/images.js";
import { collections } from "../src/db/schema/collections.js";
import { members, projects } from "../src/db/schema/projects.js";
import { tracks } from "../src/db/schema/tracks.js";
import { log } from "../src/lib/log.js";
import { fetchRemoteImage } from "../src/lib/remote-image.js";

const logger = log("ingest-external-images");

type CoverTarget = {
  kind: "project" | "collection" | "track";
  id: number;
  projectId: number;
  url: string;
};

type IngestExternalResult = {
  scanned: number;
  ingestedImages: number;
  updatedEntities: number;
  failed: { projectId: number; url: string; error: string }[];
};

const isExternalUrl = (column: Column) => sql`${column} ~ '^https?://'`;

async function findExternalTargets(): Promise<CoverTarget[]> {
  const [projectRows, collectionRows, trackRows] = await Promise.all([
    db
      .select({ id: projects.id, image: projects.image })
      .from(projects)
      .where(isExternalUrl(projects.image))
      .orderBy(asc(projects.id)),
    db
      .select({
        id: collections.id,
        projectId: collections.projectId,
        image: collections.image,
      })
      .from(collections)
      .where(isExternalUrl(collections.image))
      .orderBy(asc(collections.id)),
    db
      .select({
        id: tracks.id,
        projectId: tracks.projectId,
        image: tracks.image,
      })
      .from(tracks)
      .where(isExternalUrl(tracks.image))
      .orderBy(asc(tracks.id)),
  ]);

  return [
    ...projectRows.map((row) => ({
      kind: "project" as const,
      id: row.id,
      projectId: row.id,
      url: row.image!,
    })),
    ...collectionRows.map((row) => ({
      kind: "collection" as const,
      id: row.id,
      projectId: row.projectId,
      url: row.image!,
    })),
    ...trackRows.map((row) => ({
      kind: "track" as const,
      id: row.id,
      projectId: row.projectId,
      url: row.image!,
    })),
  ];
}

async function projectOwnerId(projectId: number): Promise<string | null> {
  const [owner] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.projectId, projectId), eq(members.role, "owner")))
    .orderBy(asc(members.id))
    .limit(1);
  return owner?.userId ?? null;
}

export async function ingestExternalImages(
  options: {
    dryRun?: boolean;
    fetchImage?: typeof fetchRemoteImage;
  } = {}
): Promise<IngestExternalResult> {
  const dryRun = options.dryRun ?? false;
  const fetchImage = options.fetchImage ?? fetchRemoteImage;
  const targets = await findExternalTargets();

  // Deduplicate by (projectId, url) so a cover shared across a project and
  // its collections is fetched and stored once.
  const groups = new Map<
    string,
    { projectId: number; url: string; targets: CoverTarget[] }
  >();
  for (const target of targets) {
    const key = `${target.projectId}\0${target.url}`;
    const existing = groups.get(key);
    if (existing) existing.targets.push(target);
    else
      groups.set(key, {
        projectId: target.projectId,
        url: target.url,
        targets: [target],
      });
  }

  const result: IngestExternalResult = {
    scanned: targets.length,
    ingestedImages: 0,
    updatedEntities: 0,
    failed: [],
  };

  for (const group of groups.values()) {
    if (dryRun) {
      result.ingestedImages++;
      result.updatedEntities += group.targets.length;
      continue;
    }

    try {
      const remote = await fetchImage(group.url);
      const userId = await projectOwnerId(group.projectId);
      const uploaded = await ingestImage(remote, {
        scope: "project",
        projectId: group.projectId,
        userId,
      });
      result.ingestedImages++;

      for (const target of group.targets) {
        await setImageOnParent(
          uploaded.id,
          target.kind,
          target.id,
          group.projectId
        );
        result.updatedEntities++;
      }
    } catch (error) {
      result.failed.push({
        projectId: group.projectId,
        url: group.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  logger.info("scanning for external entity image URLs", { dryRun });

  try {
    const report = await ingestExternalImages({ dryRun });
    logger.info(
      dryRun ? "dry run complete" : "external image ingestion complete",
      report
    );
    if (report.failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
