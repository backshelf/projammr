CREATE TABLE "machines" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" varchar(64) NOT NULL,
	"platform" varchar(64) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"open_session_id" integer,
	"repo_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machines_user_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE INDEX "machines_user" ON "machines" ("user_id");--> statement-breakpoint
CREATE INDEX "machines_open_session" ON "machines" ("open_session_id");--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_open_session_id_sessions_id_fkey" FOREIGN KEY ("open_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;