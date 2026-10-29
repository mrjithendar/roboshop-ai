/** Comment types and constants shared by the server (lib/comments) and the discussion UI. No server imports. */

export const COMMENT_MAX = 5000;
export const REPORT_NOTE_MAX = 500;

export const REPORT_REASONS = ["spam", "abuse", "off-topic", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const reportReasonLabels: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  abuse: "Harassment, hate or abuse",
  "off-topic": "Off-topic",
  other: "Something else",
};

export type CommentSort = "oldest" | "newest";
export type Viewer = { id: string; role: "admin" | "author" | "user" } | null;

export type DiscussionState = { enabled: boolean; locked: boolean; requireApproval: boolean; editWindowMinutes: number };

/** What the browser receives for one comment. Never contains emails, user ids or profile fields beyond name and avatar. */
export type CommentView = {
  id: string;
  parentId: string | null;
  /** Set when the reply is shown below a different comment than the one it answers (depth limit). */
  replyTo: { id: string; name: string | null } | null;
  /** A neutral placeholder kept so replies stay in place; no author, text or counts. */
  tombstone: boolean;
  author: { name: string; image: string | null; badge: "admin" | "author" | null } | null;
  /** Sanitised HTML from renderCommentMarkdown. */
  html: string;
  createdAt: string;
  editedAt: string | null;
  likes: number;
  likedByMe: boolean;
  reportedByMe: boolean;
  /** The viewer's own comment, waiting for approval (only ever sent to its author). */
  pending: boolean;
  mine: boolean;
  can: { reply: boolean; edit: boolean; delete: boolean; like: boolean; report: boolean };
  replies: CommentView[];
};

export type CommentPage = { state: DiscussionState; threads: CommentView[]; nextCursor: string | null; total: number };
