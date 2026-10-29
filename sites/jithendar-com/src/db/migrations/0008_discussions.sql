-- Discussions: replies, edits, author deletes, likes, reports and a per-post discussion mode.
-- Additive; existing comments become top-level comments (depth 0) and keep their status.
ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "discussion" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "root_id" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN IF NOT EXISTS "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_id_post_idx" ON "comment" USING btree ("id","post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_parent_idx" ON "comment" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_user_client_key_idx" ON "comment" USING btree ("user_id","client_key") WHERE "client_key" is not null;--> statement-breakpoint
-- A reply's parent must be a comment on the same post (the database refuses cross-post replies too).
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_same_post_fk" FOREIGN KEY ("parent_id","post_id") REFERENCES "public"."comment"("id","post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_like" (
	"comment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_like_pk" PRIMARY KEY("comment_id","user_id")
);--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_like_user_idx" ON "comment_like" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text
);--> statement-breakpoint
ALTER TABLE "comment_report" ADD CONSTRAINT "comment_report_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_report" ADD CONSTRAINT "comment_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_report_user_idx" ON "comment_report" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_report_open_idx" ON "comment_report" USING btree ("resolved_at","created_at");
