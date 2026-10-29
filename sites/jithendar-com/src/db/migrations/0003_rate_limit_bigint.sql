-- Better Auth stores rate-limit timestamps in milliseconds (Date.now()), which overflow int4.
ALTER TABLE "rate_limit" ALTER COLUMN "last_request" SET DATA TYPE bigint;
