CREATE TYPE "commit_kind" AS ENUM('user', 'checkpoint');--> statement-breakpoint
CREATE TABLE "objects" (
	"hash" text PRIMARY KEY,
	"kind" smallint NOT NULL,
	"size" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_objects" (
	"repo_id" integer,
	"object_hash" text,
	"pushed_by" text,
	"pushed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repo_objects_pkey" PRIMARY KEY("repo_id","object_hash")
);
--> statement-breakpoint
CREATE TABLE "save_objects" (
	"save_id" integer,
	"object_hash" text,
	CONSTRAINT "save_objects_pkey" PRIMARY KEY("save_id","object_hash")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"session_id" integer NOT NULL,
	"name" text NOT NULL,
	"head_commit_id" integer,
	CONSTRAINT "branch_session_name" UNIQUE("session_id","name")
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"repo_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"hash" text NOT NULL,
	"save_id" integer NOT NULL,
	"parent_id" integer,
	"message" text NOT NULL,
	"author_id" text,
	"machine_name" text,
	"kind" "commit_kind" NOT NULL,
	"committed_at" timestamp NOT NULL,
	CONSTRAINT "commit_repo_hash" UNIQUE("repo_id","hash")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"last_push_at" timestamp,
	"last_push_machine" text,
	CONSTRAINT "repo_project_name" UNIQUE("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "dit_set_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "current_branch_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "session_repo_dit_set" UNIQUE("repo_id","dit_set_id");--> statement-breakpoint
CREATE INDEX "repo_object_hash" ON "repo_objects" ("object_hash");--> statement-breakpoint
CREATE INDEX "save_object_hash" ON "save_objects" ("object_hash");--> statement-breakpoint
CREATE INDEX "save_branch" ON "saves" ("branch_id");--> statement-breakpoint
CREATE INDEX "commit_session_time" ON "commits" ("session_id","committed_at");--> statement-breakpoint
CREATE INDEX "commit_branch" ON "commits" ("branch_id");--> statement-breakpoint
CREATE INDEX "commit_save" ON "commits" ("save_id");--> statement-breakpoint
CREATE INDEX "commit_parent" ON "commits" ("parent_id");--> statement-breakpoint
ALTER TABLE "repo_objects" ADD CONSTRAINT "repo_objects_repo_id_repos_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repo_objects" ADD CONSTRAINT "repo_objects_object_hash_objects_hash_fkey" FOREIGN KEY ("object_hash") REFERENCES "objects"("hash") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "repo_objects" ADD CONSTRAINT "repo_objects_pushed_by_users_id_fkey" FOREIGN KEY ("pushed_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "save_objects" ADD CONSTRAINT "save_objects_save_id_saves_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "save_objects" ADD CONSTRAINT "save_objects_object_hash_objects_hash_fkey" FOREIGN KEY ("object_hash") REFERENCES "objects"("hash") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_branch_id_branches_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_head_commit_id_commits_id_fkey" FOREIGN KEY ("head_commit_id") REFERENCES "commits"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_repo_id_repos_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_branch_id_branches_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_save_id_saves_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id");--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_parent_id_commits_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "commits"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_id_repos_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_current_branch_id_branches_id_fkey" FOREIGN KEY ("current_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;