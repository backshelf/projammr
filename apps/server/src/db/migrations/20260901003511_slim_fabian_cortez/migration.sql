CREATE TABLE "invites"
(
    "id"          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at"  timestamp     DEFAULT now()                   NOT NULL,
    "updated_at"  timestamp     DEFAULT now()                   NOT NULL,
    "project_id"  integer                                       NOT NULL,
    "email"       text                                          NOT NULL,
    "role"        "member_role" DEFAULT 'viewer'::"member_role" NOT NULL,
    "token"       text                                          NOT NULL UNIQUE,
    "invited_by"  text,
    "expires_at"  timestamp                                     NOT NULL,
    "accepted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invite_project_email" ON "invites" ("project_id", "email") WHERE ("accepted_at" is null);--> statement-breakpoint
ALTER TABLE "invites"
    ADD CONSTRAINT "invites_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invites"
    ADD CONSTRAINT "invites_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE SET NULL;