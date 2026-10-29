# Media: Cloudflare R2, responsive delivery, AI images

Status: implemented 2026-10-29. Live R2 and Gemini checks **require manual configuration** (see the end).

## Architecture

```
 editor (browser) ──server action (≤10 MB images)──▶ site pod ──S3 API──▶ R2 bucket
        │                                              ▲   │              jithendar/www/media/{type}/{yyyy}/{mm}/{id}.{ext}
        └──presigned PUT (video/audio/PDF, ≤200 MB)────┼───┼────────────▶ jithendar/www/tmp/generated/… (AI drafts, 1 day)
                                                       │   │
 reader ──/media/{id}/{name}──▶ site pod ──stream──────┘   └──Gemini Interactions API (Generate image)
        ──/_next/image?url=/media/…&w=…──▶ next/image (sharp) → AVIF/WebP, disk-cached
        ──(video/audio/PDF, when R2_PUBLIC_BASE_URL is set)──301──▶ public R2 domain (Cloudflare CDN, range requests)
```

No new service: storage, validation, image optimisation and Gemini calls run in the existing Next.js app.
A separate image service was not needed — `next/image` already resizes in the pods and is bounded (below).

| Concern | Where |
|---|---|
| R2 client, keys, presigning, config | `src/lib/storage.ts` |
| Legacy S3 (read-only, migration source) | `src/lib/storage-legacy.ts` |
| Validation, uploads, media records | `src/lib/media.ts` |
| Delivery (`/media/{id}/{name}`) | `src/app/media/[id]/[name]/route.ts` |
| S3 → R2 migration | `src/lib/media-migration.ts`, Admin → Storage, `GET /api/admin/media-migration` (manifest) |
| Gemini client | `src/lib/gemini.ts` |
| Generation workflow, limits, cleanup | `src/lib/image-generation.ts`, `POST /api/admin/images/generate`, `GET /api/admin/images/generations/{id}` |
| Editor UI | `src/components/admin/{CoverImagePicker,GenerateImageDialog,MediaPicker,Dialog}.tsx`, `src/app/admin/media/MediaUploader.tsx` |
| Schema | `src/db/migrations/0004_r2_media.sql` (`media` columns, `image_generation` table) |

## Object keys

`jithendar/www/media/{type}/{yyyy}/{mm}/{unique-id}.{extension}` — a key prefix inside the bucket.
`{type}` is `images`, `videos`, `audio` or `documents`; `{unique-id}` is the media row's random UUID;
the extension comes from the detected content type. User-supplied names never reach the key (they only
become the readable `{name}` in `/media/{id}/{name}`). Unaccepted AI images live under
`jithendar/www/tmp/generated/{yyyy}/{mm}/{id}.{ext}`.

## Upload rules

| Type | Formats (checked by magic bytes, not name) | Max | Path |
|---|---|---|---|
| images | JPEG, PNG, WebP, AVIF, GIF (no SVG: scripts) | 10 MB, ≤12 000 px a side | server action → `PutObject` with `Content-MD5` |
| videos | MP4, WebM | 200 MB | presigned `PUT` (10 min, `Content-Type` + `Content-Length` signed) → server verifies |
| audio | MP3, M4A, Ogg, WAV | 50 MB | presigned |
| documents | PDF | 20 MB | presigned |

Presigned flow: the browser computes SHA-256 → `requestUpload` validates type/size/alt, creates a
`pending` row (invisible everywhere) and signs a PUT for exactly that key/type/size → browser PUTs to R2
→ `finishUpload` HEADs the object (size), streams it to recompute SHA-256, sniffs the real type and,
for images, decodes dimensions. Any mismatch deletes the object and row. Pending rows older than an hour
are purged (before each new upload, and by Admin → Database → "Delete abandoned uploads…").

Objects get `Cache-Control: public, max-age=31536000, immutable` (names are unique). Private files
(`visibility = private`) are only reachable by signed-in staff via a 5-minute presigned GET.

## Transformation (resizing) and its limits

R2 does not resize. `next/image` does, inside the site pods, from `/images/**` and `/media/**` only:

- widths: `deviceSizes` 640, 750, 828, 1080, 1200, 1920 and `imageSizes` 96, 128, 256, 384 — any other `w` is a 400;
- one quality (75), formats AVIF then WebP (original as fallback for old browsers);
- sources over 12 MB refused (`maximumResponseBody`), redirects not followed;
- results cached on disk for 30 days, LRU-capped at 200 MB (`maximumDiskCacheSize`) inside the 256 MiB `next-cache` emptyDir;
- verified locally against `next start`: `w=640`/`w=1920` → 200 `image/avif`; `w=1000`, `w=3840`, `q=100`, remote URL, `/api/health` → 400.

Components: `CoverImage` (cards, 16:9 crop around the author's focal point, `sizes` per layout, eager +
`fetchPriority="high"` only for the homepage lead card), the article hero (eager LCP image), and
`ContentImage` (Markdown images, lazy, intrinsic size, alt text placeholder when missing).

## Content shortcodes

```
::video{src="/media/<id>/clip.mp4" poster="/media/<id>/still.jpg" caption="…" ratio="16:9|4:3|1:1|9:16"}
::audio{src="/media/<id>/episode.mp3" caption="…"}
::embed{src="https://www.youtube.com/watch?v=…" title="…"}      # YouTube (youtube-nocookie) or Vimeo (dnt=1) only
```

Fixed aspect-ratio frames (no layout shift), lazy iframes, sandboxed embeds, download fallbacks. Tables
are wrapped in a focusable horizontal scroll region; code blocks scroll inside themselves.

## Generate image (Gemini)

- API: `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `x-goog-api-key`, body
  `{ model, input, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio, image_size }, store: false }`;
  image read from `steps[].content[]` blocks of `type: "image"` (base64 `data`). Checked against Google's
  published OpenAPI description on 2026-10-29. Plain `fetch` (no SDK dependency) so cancellation aborts the request.
- Model: `GEMINI_IMAGE_MODEL`, required — nothing is hard-coded. On 2026-10-29 Google's models page listed
  `gemini-3.1-flash-image` (Nano Banana 2) and `gemini-nano-banana-2.1` as stable image models.
- Limits (env): `GEMINI_IMAGE_USER_HOURLY_LIMIT` (10), `GEMINI_IMAGE_USER_CONCURRENCY` (1), `GEMINI_IMAGE_DAILY_LIMIT`
  (50, whole site), `GEMINI_IMAGE_TIMEOUT_MS` (90 000). Counted in Postgres, so they hold across replicas.
- Errors → clear messages: content-policy refusal, quota/429, timeout, cancel, unsupported option, bad key,
  unknown model, outage, no image, invalid image. Refusal detection is heuristic (Google does not document
  a refusal field for this API): `status: failed` errors or text mentioning safety/policy.
- Returned bytes are validated (allowed raster type, decodable, ≤10 MB, ≤12 000 px) before anything is stored.
- Privacy: prompts are never stored or logged — only SHA-256, length, model, ratio, size, latency, outcome.
- Lifecycle: result → `tmp/generated` (private, no-store preview) → **Use as cover** copies it to
  `media/images/…`, creates the media row and puts it in the editor (the post changes only when saved;
  nothing is published). **Discard**/close deletes it; unaccepted results are deleted after 1 hour by the
  app and after 1 day by the R2 lifecycle rule (backstop).

## Setup (in order) — requires manual configuration

1. **Bucket**: Cloudflare dashboard → R2 → Create bucket (e.g. `jithendar-media`, private).
2. **API token**: R2 → Manage API tokens → Object Read & Write, scoped to that bucket. Note the access key ID,
   secret and account ID.
3. **CORS** (needed for direct video/audio/PDF uploads): R2 → bucket → Settings → CORS policy → paste the
   rules from `deploy/r2/cors.json` (dashboard format: the array inside `CORSRules`), or:
   ```bash
   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… aws s3api put-bucket-cors --bucket jithendar-media \
     --cors-configuration file://sites/jithendar-com/deploy/r2/cors.json \
     --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com --region auto
   ```
4. **Lifecycle**: R2 → bucket → Settings → Object lifecycle rules: delete `jithendar/www/tmp/` after 1 day; abort
   incomplete multipart uploads after 1 day — or `aws s3api put-bucket-lifecycle-configuration … --lifecycle-configuration file://sites/jithendar-com/deploy/r2/lifecycle.json` (same endpoint flags).
5. **Public domain** (optional, recommended for video): bucket → Settings → Custom domains → e.g. `media.jithendar.com`.
6. **Secret**: `sites/jithendar-com/scripts/set-media-config.sh mk4` (prompts; values never echoed), then
   `kubectl --context mk4 -n jithendar rollout restart deployment/jithendar-com` — or deploy normally.
7. **Verify**: Admin → System status shows "Media storage (Cloudflare R2): ok" and "Image generation (Gemini)".
   Upload an image and a short MP4 in Admin → Media; generate a cover in a draft post.

## Migrating existing S3 media

Public URLs are `/media/{id}/{name}` and never contain a storage key, so **no stored reference changes**.
Rows created before R2 are marked `s3-legacy` by migration 0004 and keep being served from the old bucket
(Admin → Storage keeps its sealed S3 settings as the read-only source) until copied.

1. Admin → Storage → **Dry run**: lists the next 25 files with old key → new key. Nothing changes.
2. **Copy next 25** (repeat until 0 remain): copies with `Content-MD5`, checks the size, switches the row,
   records `legacy_key`. Interrupted runs resume; objects already in R2 are reused. S3 objects are never deleted.
3. **Download manifest**: JSON of `{ id, oldKey, newKey, url, publicUrl, bytes, status }` for every migrated file.
4. Spot-check pages with images. Keep the S3 bucket untouched until you are satisfied.

**Rollback**: Admin → Storage → **Roll back to S3** points every migrated row at its S3 object again (R2 copies
stay and are reused if you migrate again). Code rollback: `sites/deploy.sh <previous-sha>`; migration 0004 only
adds columns and a table, so the previous image starts and serves S3 rows (uploads it makes are labelled
`s3-legacy` by the column default). Files uploaded to R2 after the upgrade are not readable by the old image
until you roll forward again.

## Live checks still required (not run here: no R2 bucket or Gemini key in this environment)

- Real R2 upload/HEAD/GET/copy/delete, presigned PUT from a browser with the CORS policy, Range playback of a video.
- A real Gemini generation with the chosen model (and its supported aspect ratios / image sizes).
- `/_next/image` for an uploaded `/media/…` image in the cluster.
