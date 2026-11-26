ALTER TABLE "saves" ALTER COLUMN "content_state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "saves" ALTER COLUMN "content_state" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "content_state";--> statement-breakpoint
CREATE TYPE "content_state" AS ENUM('none', 'stored', 'pruned');--> statement-breakpoint
ALTER TABLE "saves" ALTER COLUMN "content_state" SET DATA TYPE "content_state" USING "content_state"::"content_state";--> statement-breakpoint
ALTER TABLE "saves" ALTER COLUMN "content_state" SET DEFAULT 'none'::"content_state";