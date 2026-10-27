CREATE TABLE "backup_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"filename" text,
	"size_bytes" integer,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"triggered_by" text
);
--> statement-breakpoint
CREATE INDEX "backup_run_started_idx" ON "backup_run" USING btree ("started_at");