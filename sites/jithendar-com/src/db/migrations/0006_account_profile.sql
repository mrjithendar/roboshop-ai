-- Private account profile fields for every user (readers included). Additive with defaults: existing rows,
-- sessions and logins are unaffected; the previous image ignores these columns, so rollback needs no down migration.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "bio" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "website" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;
