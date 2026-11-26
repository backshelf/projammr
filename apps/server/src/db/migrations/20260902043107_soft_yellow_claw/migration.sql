CREATE TYPE "priority" AS ENUM ('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
ALTER TABLE "collections"
    ADD COLUMN "priority" "priority" DEFAULT 'none'::"priority" NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "priority" "priority" DEFAULT 'none'::"priority" NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks"
    ADD COLUMN "priority" "priority" DEFAULT 'none'::"priority" NOT NULL;