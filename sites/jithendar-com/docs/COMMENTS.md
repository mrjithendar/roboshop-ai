# Discussions (comments)

The comment system under posts. It extends the original comments table and moderation page; there is no
separate Discourse instance. Code: `src/lib/comments.ts` (service), `src/lib/comment-markdown.ts` (renderer),
`src/lib/comment-types.ts` (shared types), `src/app/_actions/comments.ts` (reader actions),
`src/app/api/comments/[postId]/route.ts` (paged list), `src/components/discussion/*` (UI),
`src/app/admin/comments/page.tsx` (moderation).

## Readers

- Signed-out visitors see approved comments and a **Sign in to comment** button that returns them to
  `#comments` (or `#comment-<id>` for "Sign in to reply").
- Signed-in readers write in Markdown with **Write / Preview** (the preview uses the same server renderer),
  reply, like (one per person; not their own), copy a permalink, report (spam, abuse, off-topic, other + note),
  and edit or delete their own comments. Name and avatar are shown; never email, user id or profile fields.
- Replies nest two levels deep; deeper replies are listed at the second level with "↪ Replying to …".
- Threads load 10 at a time (oldest or newest first); replies are in time order. A permalink to a comment
  that is not on the first page loads its thread first and highlights it.
- Loading, empty, error (with Retry) and "session ended" states; keyboard and screen-reader friendly.

## Rules enforced on the server

| Rule | Where |
|---|---|
| Session required for every write; user id only from the session | `src/app/_actions/comments.ts` |
| Turnstile on new comments and replies | `submitComment` |
| 2–5000 characters; 5 comments / 10 min per account; same text twice in 10 min refused; resubmitted form (client key) returns the first comment | `submitComment` |
| Reply parent must be an approved comment **on the same post** (also a composite foreign key in the database) | `submitComment`, migration 0008 |
| Edit: own comment, discussion open, within the edit window (admins: no limit); 20 edits / 10 min | `editComment` |
| Delete: own comment, any time; text erased, a neutral placeholder stays while replies exist | `deleteOwnComment` |
| Likes: one per user per comment (primary key), not your own, 60 / 10 min | `setLike` |
| Reports: one per user per comment, 10 / hour, note ≤ 500 chars | `reportComment` |
| Public responses: approved comments only (plus the viewer's own pending ones, marked); hidden, removed, pending and deleted comments never appear, except as a placeholder with no author/text when they have visible replies | `buildPage` |
| Rendering: Markdown subset; raw HTML shown as text; only http(s)/mailto links with `rel="nofollow ugc noopener noreferrer"`; no images, no attributes | `renderCommentMarkdown` |

## Moderation (Admin → Comments; authors and admins)

Tabs: Pending, Reported, Approved, Hidden, Removed, All, Discussions.
Actions: Approve, Hide, Restore, Remove, Dismiss reports, Delete permanently (admins only, only without
replies). Each action closes the comment's open reports and is written to the audit log (`comment.<action>`,
with previous/new status, open report count and the optional note). Readers' emails are shown to admins only.

**Discussions** tab: per post Open / Locked (visible, no new comments, replies, edits or likes) / Closed (not
shown). Admins and the post's author can change it (`post.discussion` in the audit log).

**Settings** (Admin → Appearance & settings → General → Features, applied on publish): Comments on/off
site-wide, *New reader comments need approval* (default on), *Readers can edit their comments for* (minutes,
default 1440, 0 = no limit). Authors' and admins' comments never wait for approval.

Edits to an already approved comment are not re-moderated (readers can report them).

## Database

`src/db/migrations/0008_discussions.sql` (additive, runs at start-up): `post.discussion`; `comment.parent_id`,
`root_id`, `depth`, `edited_at`, `deleted_at`, `client_key` with indexes and the same-post foreign key; new
tables `comment_like` and `comment_report`. Existing comments become top-level comments with their status
unchanged; old `rejected`/`spam` rows appear under Removed. Rollback: deploy the previous image (it ignores the
new columns and tables).

## Tests

`tests/discussions.test.ts`: authorization, approval rules, Turnstile and length checks, duplicate and
idempotent submission, rate limit, cross-post replies (service and database), locked/closed discussions,
public visibility and placeholders, depth limit, paging/sorting/permalink, XSS, ownership and edit window,
likes, reports, moderation permissions and audit, and the API route (no emails, `private, no-store`).
