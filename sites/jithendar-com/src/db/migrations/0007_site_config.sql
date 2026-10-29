-- Admin → Appearance: published and draft site configuration (history in "revision", entity 'site-config').
-- Additive. Until something is published, the site keeps reading the legacy "setting" row 'site' (migrated in memory).
CREATE TABLE IF NOT EXISTS "site_config" (
	"key" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
