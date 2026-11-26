CREATE TYPE "comment_target_type" AS ENUM ('project', 'collection', 'track', 'session');--> statement-breakpoint
CREATE TABLE "comments"
(
    "id"          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at"  timestamp DEFAULT now() NOT NULL,
    "updated_at"  timestamp DEFAULT now() NOT NULL,
    "target_type" "comment_target_type"   NOT NULL,
    "target_id"   integer                 NOT NULL,
    "user_id"     text,
    "content"     text                    NOT NULL,
    "parent_id"   integer
);
--> statement-breakpoint
CREATE INDEX "comments_target" ON "comments" ("target_type", "target_id");--> statement-breakpoint
CREATE INDEX "comments_parent" ON "comments" ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_user" ON "comments" ("user_id");--> statement-breakpoint
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_parent_id_comments_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments" ("id") ON DELETE CASCADE;