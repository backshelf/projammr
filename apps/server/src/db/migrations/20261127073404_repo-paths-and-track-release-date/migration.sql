CREATE TABLE "repo_machines" (
	"repo_id" integer,
	"machine_id" text,
	"local_path" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repo_machines_pkey" PRIMARY KEY("repo_id","machine_id")
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "release_date" date;--> statement-breakpoint
CREATE INDEX "repo_machines_machine" ON "repo_machines" ("machine_id");--> statement-breakpoint
ALTER TABLE "repo_machines" ADD CONSTRAINT "repo_machines_repo_id_repos_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repo_machines" ADD CONSTRAINT "repo_machines_machine_id_machines_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE;