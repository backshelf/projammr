CREATE TYPE "storage_scope" AS ENUM('project', 'user');--> statement-breakpoint
ALTER TYPE "job_kind" ADD VALUE 'storage_audit';--> statement-breakpoint
CREATE TABLE "storage_usage" (
	"scope_kind" "storage_scope",
	"scope_id" text,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "storage_usage_pkey" PRIMARY KEY("scope_kind","scope_id")
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "variants_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "variant_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "spectrogram_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
-- Seeds the counters from the rows that own the bytes, the same sum the nightly
-- audit re-derives them with. A file in a project uploaded by a member counts
-- once towards each scope: the two are separate views of the same storage.
-- `variant_bytes` and `spectrogram_bytes` are zero on every row until the first
-- audit walks the static root, so what is counted here is the originals.
INSERT INTO "storage_usage" ("scope_kind", "scope_id", "bytes")
SELECT 'project'::"storage_scope",
       p."id"::text,
       COALESCE((SELECT SUM(a."size") FROM "assets" a WHERE a."project_id" = p."id"), 0)
     + COALESCE((SELECT SUM(i."size" + i."variant_bytes") FROM "images" i WHERE i."project_id" = p."id"), 0)
     + COALESCE((SELECT SUM(ta."spectrogram_bytes")
                   FROM "track_audios" ta
                   JOIN "tracks" t ON t."id" = ta."track_id"
                  WHERE t."project_id" = p."id"), 0)
  FROM "projects" p
UNION ALL
SELECT 'user'::"storage_scope",
       u."id",
       COALESCE((SELECT SUM(a."size") FROM "assets" a WHERE a."created_by_user" = u."id"), 0)
     + COALESCE((SELECT SUM(i."size" + i."variant_bytes") FROM "images" i WHERE i."created_by_user" = u."id"), 0)
  FROM "users" u
ON CONFLICT ("scope_kind", "scope_id") DO UPDATE
  SET "bytes" = excluded."bytes", "updated_at" = now();
