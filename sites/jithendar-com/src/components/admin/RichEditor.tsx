"use client";

import { Markdown } from "@tiptap/markdown";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { MediaPicker } from "./MediaPicker";

type Mode = "rich" | "markdown" | "preview";

/**
 * Shortcodes (`:::callout`, `::button[…]`, `::toc`) and HTML comments (owner notes) are kept verbatim
 * by editing them as Markdown; rich mode could rewrite or drop them.
 */
const SHORTCODE = /^\s*:{2,3}[a-z]|<!--/m;

const SNIPPETS: { label: string; text: string }[] = [
  { label: "Callout: info", text: ':::callout{type="info" title="Note"}\nText.\n:::' },
  { label: "Callout: warning", text: ':::callout{type="warning" title="Careful"}\nText.\n:::' },
  { label: "Button", text: '::button[Read more]{href="/about"}' },
  { label: "Figure with caption", text: ':::figure{caption="Caption"}\n![Alt text](/images/example.jpg)\n:::' },
  { label: "Collapsible details", text: ':::details{summary="More"}\nHidden text.\n:::' },
  { label: "Table of contents", text: "::toc" },
];

function words(md: string) {
  return md.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length;
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 min-w-8 rounded-md px-2 text-sm font-semibold transition-colors ${
        active ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  function link() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL (https://… or /path)", previous ?? "https://");
    if (href === null) return;
    if (href === "") c().unsetLink().run();
    else c().extendMarkRange("link").setLink({ href }).run();
  }
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      <ToolButton label="Heading 2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
      <ToolButton label="Heading 3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolButton label="Bold" active={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></ToolButton>
      <ToolButton label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></ToolButton>
      <ToolButton label="Highlight" active={s.highlight} onClick={() => c().toggleHighlight().run()}>✎</ToolButton>
      <ToolButton label="Inline code" active={s.code} onClick={() => c().toggleCode().run()}>{"</>"}</ToolButton>
      <ToolButton label="Link" active={s.link} onClick={link}>🔗</ToolButton>
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolButton label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>•</ToolButton>
      <ToolButton label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>1.</ToolButton>
      <ToolButton label="Task list" active={s.task} onClick={() => c().toggleTaskList().run()}>☑</ToolButton>
      <ToolButton label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}>❝</ToolButton>
      <ToolButton label="Code block" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}>{"{ }"}</ToolButton>
      <ToolButton label="Table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</ToolButton>
      <ToolButton label="Divider" onClick={() => c().setHorizontalRule().run()}>―</ToolButton>
      <ToolButton label="Image" onClick={onImage}>🖼</ToolButton>
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolButton label="Undo" onClick={() => s.canUndo && c().undo().run()}>↶</ToolButton>
      <ToolButton label="Redo" onClick={() => s.canRedo && c().redo().run()}>↷</ToolButton>
    </div>
  );
}

/**
 * Rich (WYSIWYG) / Markdown / Preview editor. The stored value is always Markdown, rendered on the site
 * by the same safe pipeline the Preview tab uses. Autosaves a local copy under `autosaveKey`.
 */
export function RichEditor({
  value,
  onChange,
  autosaveKey,
  mediaContext,
  placeholder = "Write something people will want to read…",
}: {
  value: string;
  onChange: (markdown: string) => void;
  autosaveKey: string;
  mediaContext: string;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<Mode>(SHORTCODE.test(value) ? "markdown" : "rich");
  const [preview, setPreview] = useState<string>("");
  const [picker, setPicker] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Rendered client-side only (PostEditor loads it with ssr: false), so localStorage is available here.
  const [restorable, setRestorable] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(autosaveKey);
      return saved && saved !== value ? saved : null;
    } catch {
      return null;
    }
  });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true } }),
      Markdown,
      Highlight,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value,
    contentType: "markdown",
    editorProps: { attributes: { class: "prose prose-slate max-w-none min-h-[420px] px-6 py-5 focus:outline-none dark:prose-invert" } },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      latest.current = md;
      onChange(md);
    },
  });

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(autosaveKey, value);
      } catch {
        /* storage unavailable */
      }
    }, 800);
    return () => window.clearTimeout(id);
  }, [value, autosaveKey]);

  function switchTo(next: Mode) {
    if (next === mode) return;
    if (next === "rich") {
      if (SHORTCODE.test(latest.current) && !window.confirm("This text uses shortcodes or hidden notes. Rich mode may rewrite or drop them; keep editing in Markdown mode. Switch anyway?")) return;
      editor?.commands.setContent(latest.current, { contentType: "markdown" });
    }
    if (next === "preview") {
      setPreview("<p>Rendering…</p>");
      void fetch("/api/admin/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: latest.current }) })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(setPreview)
        .catch(() => setPreview("<p>Preview is unavailable right now.</p>"));
    }
    setMode(next);
  }

  function setMarkdown(md: string) {
    latest.current = md;
    onChange(md);
  }

  function insertImage(src: string, alt: string) {
    if (mode === "rich" && editor) {
      editor.chain().focus().setImage({ src, alt }).run();
    } else {
      insertText(`![${alt}](${src})`);
    }
  }

  function insertText(snippet: string) {
    const el = textarea.current;
    const md = latest.current;
    const at = el ? el.selectionStart : md.length;
    const next = `${md.slice(0, at)}${at > 0 && md[at - 1] !== "\n" ? "\n\n" : ""}${snippet}\n${md.slice(at)}`;
    setMarkdown(next);
    if (mode !== "markdown") setMode("markdown");
  }

  const count = words(value);
  const tabs: { id: Mode; label: string }[] = [
    { id: "rich", label: "Rich" },
    { id: "markdown", label: "Markdown" },
    { id: "preview", label: "Preview" },
  ];

  return (
    <div className={fullscreen ? "fixed inset-0 z-40 overflow-y-auto bg-white p-4 dark:bg-surface-dark" : ""}>
      {restorable !== null && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
          There is an unsaved local draft from an earlier session.
          <span className="flex gap-2">
            <button type="button" className="font-semibold underline" onClick={() => { setMarkdown(restorable); editor?.commands.setContent(restorable, { contentType: "markdown" }); setRestorable(null); }}>
              Restore it
            </button>
            <button type="button" className="underline" onClick={() => setRestorable(null)}>Dismiss</button>
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-surface-dark-raised">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-white/10">
          <div role="tablist" aria-label="Editor mode" className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/5">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} onClick={() => switchTo(t.id)}
                className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === t.id ? "bg-white text-ink shadow-sm dark:bg-surface-dark-raised dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {mode === "rich" && editor && <Toolbar editor={editor} onImage={() => setPicker(true)} />}
          {mode === "markdown" && (
            <div className="flex items-center gap-2">
              <select aria-label="Insert shortcode" className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-white/15 dark:bg-surface-dark" value=""
                onChange={(e) => { const s = SNIPPETS.find((x) => x.label === e.target.value); if (s) insertText(s.text); }}>
                <option value="">Insert shortcode…</option>
                {SNIPPETS.map((s) => <option key={s.label}>{s.label}</option>)}
              </select>
              <ToolButton label="Insert image" onClick={() => setPicker(true)}>🖼</ToolButton>
            </div>
          )}
          <ToolButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => setFullscreen((f) => !f)}>{fullscreen ? "⤡" : "⤢"}</ToolButton>
        </div>

        {mode === "rich" && editor && (
          <>
            <BubbleMenu editor={editor} className="flex gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-surface-dark-raised">
              <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>
              <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolButton>
              <ToolButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</ToolButton>
              <ToolButton label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>✎</ToolButton>
            </BubbleMenu>
            <EditorContent editor={editor} />
          </>
        )}
        {mode === "markdown" && (
          <textarea ref={textarea} value={value} onChange={(e) => setMarkdown(e.target.value)} spellCheck
            aria-label="Markdown source" className="block min-h-[420px] w-full resize-y bg-transparent px-6 py-5 font-mono text-sm leading-6 text-ink focus:outline-none dark:text-slate-100" />
        )}
        {mode === "preview" && (
          // Rendered by the server with the site's safe Markdown pipeline (no raw HTML or scripts).
          <div className="prose prose-slate max-w-none px-6 py-5 dark:prose-invert" dangerouslySetInnerHTML={{ __html: preview }} />
        )}

        <div className="flex justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
          <span>{count} words · {Math.max(1, Math.round(count / 220))} min read</span>
          <span>Saved locally as you type</span>
        </div>
      </div>
      <MediaPicker open={picker} onClose={() => setPicker(false)} context={mediaContext} title="Insert an image"
        onSelect={(item) => { insertImage(item.src, item.alt || "Image"); setPicker(false); }} />
    </div>
  );
}
