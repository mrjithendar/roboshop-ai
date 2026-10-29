# Editor

Status: implemented 2026-10-29.

## Architecture and canonical format

**Markdown is the single source of truth** (`post.body`, `page.body`), exactly what the site renders with
`lib/mdx/compile.ts` (format `md`: raw HTML, JSX, imports and expressions are never executed). The visual editor
(Tiptap 3, already a dependency; MIT, no paid parts) is a view over it:

```
stored Markdown ─parse─▶ editor document ─serialize─▶ stored Markdown      (lib/editor/markdown.ts)
```

- Standard blocks map 1:1: paragraphs, H2–H6 (the title is H1), bold/italic/strike/inline code/links, bulleted,
  numbered and task lists, quotes, dividers, code blocks with language, tables, images with alt text.
- Shortcodes (`:::callout`, `:::figure`, `:::gallery`, `::button`, `::embed`, `::video`, `::audio`, `:::details`,
  `::toc`), HTML comments and raw HTML/JSX blocks become **protected blocks**: shown as cards, edited as source,
  serialized byte for byte. Unknown shortcodes are preserved too (rendered as plain text on the site).
- Before opening visually, `fidelity()` round-trips the document. If anything meaningful would change (e.g. inline
  raw HTML), the editor opens in **Markdown** mode with the reason, and switching to visual asks first.
  All bundled content round-trips losslessly (tested).
- Safety: links/images accept only `http(s)`, `mailto`, site paths and anchors (editor, save validation, and a
  render-time filter for older content). Embeds only YouTube (privacy mode) and Vimeo (dnt), sandboxed. Pasted HTML
  is reduced to the editor schema. No remote fetching (no SSRF surface).

## Authoring

- Insert blocks with **+** (searchable) or by typing **/** in an empty paragraph (↑/↓, Enter, Esc).
- Block actions (toolbar or keys): move **Alt Shift ↑/↓**, duplicate **Ctrl/⌘ Shift D**, delete **Alt Shift Backspace**;
  undo/redo **Ctrl/⌘ Z / Shift Z**; save **Ctrl/⌘ S**. Drag handles are not required for any action.
- Images: library picker with search and paging; upload by choosing, dropping or pasting; alt text required;
  caption, alignment (centered/wide/full) and size (small/medium/large) via `:::figure`. Galleries via `:::gallery`.
  Removing an image from a post never deletes the file; Media shows where a file is used and refuses deletion while used.
- Featured image: choose, upload, **Generate image** (Gemini, see MEDIA.md), focal point; social image optional.
- Focus mode hides the admin chrome; on phones the settings open as a full-screen drawer.

## Saving and publishing

| Action | Effect |
|---|---|
| Typing | autosaved after 2.5 s as **your** working copy (server, per user and document; browser storage for new posts). Readers never see it. |
| Save draft | commits a draft (new revision) |
| Publish | publishes now, or **schedules** when the publish time (IST) is in the future |
| Update | commits changes to a published post (until then the live version is unchanged) |
| Switch to draft | unpublishes |

- **Optimistic concurrency**: every commit carries the version it was based on; a newer save elsewhere returns a
  conflict with *Load latest* (your edits are kept as a recovery copy) or *Overwrite with mine* (the overwritten version
  stays in history).
- **Recovery**: after a refresh/crash/offline period the editor offers the newer autosaved copy (restore/discard).
- **Revisions**: every commit (create, save, publish, schedule, update, unpublish, restore, scheduled publish) stores a
  snapshot with author and time. Preview any revision; *Load into editor* then Save creates a new revision — history is
  never rewritten. Existing content got a `baseline` revision in migration 0005.
- **Scheduling** is server-side (`lib/scheduler.ts`, every 30 s in each pod): conditional updates publish each post
  exactly once, across replicas and restarts; overdue posts publish as soon as the site is back. Status: Admin → System
  status ("Scheduled publishing & IndexNow"). Times are entered and shown in Asia/Kolkata and stored in UTC.
- After every committed change: content caches are invalidated on all replicas, sitemaps/feeds reflect it on the next
  request, and IndexNow is queued (idempotent job queue; failures never block saving).
- Original publication dates are kept when republishing (imports keep theirs).
- Previews (`/preview/<token>`): staff only, 1-hour tokens, `noindex`, `private, no-store`; the Preview dialog renders
  the unsaved document with the real site components at mobile/tablet/desktop widths.

## Dashboards

Posts: status tabs (all, drafts, review, scheduled, published, archived, trash) with counts, search, pagination,
edit/preview/duplicate/trash per row, bulk publish/draft/archive/trash, and in Trash restore/delete permanently
(confirmed). Duplicates are drafts with a unique `-copy` slug. Pages: search, trash/restore/delete, menu order,
SEO fields, revisions; bundled policy drafts (content/pages) are offered for review and never auto-published.

## Permissions (existing roles)

| | admin | author | user |
|---|---|---|---|
| Create, edit, publish, schedule, trash, restore, delete, duplicate posts | all posts | own posts | — |
| Revisions / autosave | all posts | own posts (own autosaves only) | — |
| Pages | ✓ | ✓ | — |
| Media upload/alt text/delete | ✓ | ✓ | — |

Every action is checked server-side (server actions carry Next.js's same-origin check; the JSON image-generation
endpoint checks `Origin`). Autosaves and revisions contain draft text and are only readable through these checks;
logs never include post bodies.

## Not included

- Editor-side syntax highlighting (the language is chosen in the editor; highlighting shows in Preview and on the site).
- Reassigning a post's author (shown read-only).
- Page parents (pages live at the top level by design).
