-- Media moves to Cloudflare R2. Existing rows keep pointing at the legacy S3 bucket until migrated.
-- The default stays 's3-legacy': the app always writes 'r2' explicitly, so only an older image (after a
-- rollback, still uploading to S3) relies on the default, and its rows are then labelled correctly.
ALTER TABLE "media" ADD COLUMN "storage_backend" text DEFAULT 's3-legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "legacy_key" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "kind" text DEFAULT 'images' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "width" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "height" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "media_status_created_idx" ON "media" USING btree ("status","created_at");
--> statement-breakpoint
CREATE TABLE "image_generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text REFERENCES "user"("id") ON DELETE set null,
	"model" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"image_size" text NOT NULL,
	"prompt_sha256" text NOT NULL,
	"prompt_chars" integer NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"temp_key" text,
	"content_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"checksum_sha256" text,
	"latency_ms" integer,
	"media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "image_generation_user_created_idx" ON "image_generation" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "image_generation_status_idx" ON "image_generation" USING btree ("status","created_at");
