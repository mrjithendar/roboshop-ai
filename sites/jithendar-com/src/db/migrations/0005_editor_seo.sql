-- SEO/social fields, scheduling, trash and optimistic concurrency for posts and pages;
-- revisions, server-side autosave and a small job queue (IndexNow submissions with retries).
ALTER TABLE "post" ADD COLUMN "seo_title" text;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "seo_description" text;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "social_title" text;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "social_description" text;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "social_image" jsonb;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "noindex" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "seo_title" text;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "seo_description" text;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "noindex" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "sort_order" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"author_id" text REFERENCES "user"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "revision_entity_idx" ON "revision" USING btree ("entity","entity_id","created_at");
--> statement-breakpoint
CREATE TABLE "autosave" (
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"base_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autosave_pk" PRIMARY KEY ("entity","entity_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_pending_dedupe_idx" ON "job" USING btree ("dedupe_key") WHERE "status" IN ('queued','running');
--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("status","run_at");
--> statement-breakpoint
-- Existing content gets its first revision, so history starts from what is live today.
INSERT INTO "revision" ("entity","entity_id","version","reason","payload","author_id","created_at")
SELECT 'post', p."id"::text, 1, 'baseline', to_jsonb(p) - 'version', p."author_id", p."saved_at" FROM "post" p;
--> statement-breakpoint
INSERT INTO "revision" ("entity","entity_id","version","reason","payload","created_at")
SELECT 'page', g."slug", 1, 'baseline', to_jsonb(g) - 'version', g."saved_at" FROM "page" g;
