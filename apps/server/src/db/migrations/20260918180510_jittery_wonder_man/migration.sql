CREATE TABLE "signin_attempts" (
	"email_hash" text PRIMARY KEY,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp
);
