"use client";

import { Extension, type Editor } from "@tiptap/core";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Markdown } from "@tiptap/markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { editorExtensions, fidelity, isSafeUrl, ProtectedBlock } from "@/lib/editor/markdown";
import { embedUrl } from "@/lib/mdx/shortcodes";
import { Dialog } from "../Dialog";
import { MediaPicker } from "../MediaPicker";

/* ---------------------------------------------------------------------------------------------
 * Block operations on top-level blocks (keyboard-accessible alternatives to drag and drop).
 * ------------------------------------------------------------------------------------------- */

function currentBlock(editor: Editor) {
  const { doc, selection } = editor.state;
  const index = selection.$from.index(0);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { index, pos, node: doc.child(index), count: doc.childCount };
}

export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { index, pos, node, count } = currentBlock(editor);
  const target = index + dir;
  if (target < 0 || target >= count) return false;
  const { tr, doc } = editor.state;
  const neighbour = doc.child(target);
  const offset = editor.state.selection.from - pos;
  tr.delete(pos, pos + node.nodeSize);
  const insertAt = dir < 0 ? pos - neighbour.nodeSize : pos + neighbour.nodeSize;
  tr.insert(insertAt, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + offset, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateBlock(editor: Editor): boolean {
  const { pos, node } = currentBlock(editor);
  const tr = editor.state.tr.insert(pos + node.nodeSize, node.copy(node.content));
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + node.nodeSize + 1))).scrollIntoView());
  return true;
}

export function deleteBlock(editor: Editor): boolean {
  const { pos, node, count } = currentBlock(editor);
  const { tr, schema } = editor.state;
  if (count === 1) tr.replaceWith(0, tr.doc.content.size, schema.nodes.paragraph!.create());
  else tr.delete(pos, pos + node.nodeSize);
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)))).scrollIntoView());
  return true;
}

const BlockKeys = Extension.create({
  name: "blockKeys",
  addKeyboardShortcuts() {
    return {
      "Alt-Shift-ArrowUp": () => moveBlock(this.editor, -1),
      "Alt-Shift-ArrowDown": () => moveBlock(this.editor, 1),
      "Mod-Shift-d": () => duplicateBlock(this.editor),
      "Alt-Shift-Backspace": () => deleteBlock(this.editor),
    };
  },
});

/* ---------------------------------------------------------------------------------------------
 * Protected blocks (shortcodes, comments, raw HTML): shown as cards, edited as source.
 * ------------------------------------------------------------------------------------------- */

function describe(source: string): string {
  if (source.startsWith("<!--")) return "Hidden note (HTML comment, not shown to readers)";
  if (source.startsWith("<")) return "Raw HTML/JSX (kept as-is; not rendered on the site)";
  const name = /^:{2,}([a-z][\w-]*)/.exec(source)?.[1] ?? "shortcode";
  const labels: Record<string, string> = { callout: "Callout", button: "Button", figure: "Image with caption", gallery: "Gallery", details: "Collapsible details", toc: "Table of contents", video: "Video", audio: "Audio", embed: "Embedded video" };
  return labels[name] ?? `Shortcode “${name}” (not supported by the site; shown as text)`;
}

function ProtectedView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(node.attrs.source));
  const source = String(node.attrs.source);
  return (
    <NodeViewWrapper className={`not-prose my-4 rounded-xl border bg-slate-50 p-3 dark:bg-white/5 ${selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-white/10"}`} data-drag-handle>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{describe(source)}</span>
        <span className="flex gap-1">
          <button type="button" className="rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-white dark:text-brand-300 dark:hover:bg-white/10" onClick={() => { setDraft(source); setOpen(true); }}>
            Edit
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-white dark:hover:bg-white/10" onClick={() => deleteNode()}>
            Remove
          </button>
        </span>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700 dark:text-slate-300">{source}</pre>
      <Dialog open={open} onClose={() => setOpen(false)} title={describe(source)} size="md"
        footer={<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="button" onClick={() => { updateAttributes({ source: draft.replace(/\s+$/, "") }); setOpen(false); }}>Apply</Button></div>}>
        <Field label="Source" htmlFor="pb-source" hint="Shortcode syntax is documented in the editor help (?). Only listed shortcodes render on the site.">
          <Textarea id="pb-source" rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-xs" data-autofocus />
        </Field>
      </Dialog>
    </NodeViewWrapper>
  );
}

const ProtectedBlockView = ProtectedBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ProtectedView);
  },
});

/* ---------------------------------------------------------------------------------------------
 * Block inserter (also opened by typing "/" in an empty paragraph).
 * ------------------------------------------------------------------------------------------- */

type BlockDef = { id: string; label: string; keywords: string; run: (e: Editor, ui: InserterUi) => void };
type InserterUi = { pickImage: () => void; ask: (q: AskRequest) => void };
type AskRequest = { title: string; fields: { name: string; label: string; hint?: string; placeholder?: string; options?: string[] }[]; submit: (v: Record<string, string>) => string | null };

const insertShortcode = (e: Editor, source: string) => e.chain().focus().insertContent({ type: "protectedBlock", attrs: { source } }).run();
const attr = (v: string) => v.replace(/["\n\r]/g, "'").trim();

export const BLOCKS: BlockDef[] = [
  { id: "p", label: "Paragraph", keywords: "text", run: (e) => e.chain().focus().setParagraph().run() },
  ...[2, 3, 4, 5, 6].map((level) => ({ id: `h${level}`, label: `Heading ${level}`, keywords: `title h${level}`, run: (e: Editor) => e.chain().focus().setHeading({ level: level as 2 }).run() })),
  { id: "ul", label: "Bulleted list", keywords: "unordered bullet", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "ol", label: "Numbered list", keywords: "ordered number", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "task", label: "Task list", keywords: "todo checkbox", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "Quote", keywords: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code block", keywords: "pre snippet", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "hr", label: "Divider", keywords: "separator line rule", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: "table", label: "Table", keywords: "grid", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "image", label: "Image", keywords: "picture photo figure caption", run: (_e, ui) => ui.pickImage() },
  {
    id: "gallery",
    label: "Gallery",
    keywords: "images grid",
    run: (e) => insertShortcode(e, ':::gallery{caption="Caption"}\n![Describe image 1](/images/example.jpg) ![Describe image 2](/images/example.jpg)\n:::'),
  },
  ...(["info", "tip", "warning", "danger"] as const).map((type) => ({
    id: `callout-${type}`,
    label: `Callout: ${type}`,
    keywords: "note alert admonition",
    run: (e: Editor, ui: InserterUi) =>
      ui.ask({
        title: `Callout (${type})`,
        fields: [{ name: "title", label: "Title (optional)" }, { name: "text", label: "Text" }],
        submit: (v) => (v.text?.trim() ? (insertShortcode(e, `:::callout{type="${type}"${v.title ? ` title="${attr(v.title)}"` : ""}}\n${v.text.trim()}\n:::`), null) : "Enter the callout text."),
      }),
  })),
  {
    id: "button",
    label: "Button",
    keywords: "link cta",
    run: (e, ui) =>
      ui.ask({
        title: "Button",
        fields: [{ name: "label", label: "Label" }, { name: "href", label: "Link", placeholder: "/about or https://…" }],
        submit: (v) => {
          if (!v.label?.trim()) return "Enter a label.";
          if (!isSafeUrl(v.href ?? "")) return "Use a site path (/…) or an https:// link.";
          insertShortcode(e, `::button[${v.label.replace(/[\][\n]/g, "")}]{href="${attr(v.href!)}"}`);
          return null;
        },
      }),
  },
  {
    id: "embed",
    label: "Video embed (YouTube / Vimeo)",
    keywords: "youtube vimeo video",
    run: (e, ui) =>
      ui.ask({
        title: "Embed a video",
        fields: [{ name: "src", label: "YouTube or Vimeo URL", placeholder: "https://www.youtube.com/watch?v=…" }, { name: "title", label: "Title (for screen readers)" }],
        submit: (v) => {
          if (!embedUrl(v.src)) return "Only YouTube and Vimeo links are allowed.";
          insertShortcode(e, `::embed{src="${attr(v.src!)}" title="${attr(v.title || "Video")}"}`);
          return null;
        },
      }),
  },
  {
    id: "video",
    label: "Uploaded video or audio",
    keywords: "mp4 mp3 podcast media",
    run: (e, ui) =>
      ui.ask({
        title: "Uploaded video or audio",
        fields: [{ name: "src", label: "Media link", hint: "Copy it from Admin → Media, e.g. /media/<id>/clip.mp4", placeholder: "/media/…" }, { name: "caption", label: "Caption (optional)" }],
        submit: (v) => {
          const src = v.src?.trim() ?? "";
          if (!/^\/media\/[0-9a-f-]{36}\/[a-z0-9-]+\.[a-z0-9]{2,5}$/.test(src)) return "Paste a /media/… link from the media library.";
          const kind = /\.(mp3|m4a|ogg|wav)$/.test(src) ? "audio" : "video";
          insertShortcode(e, `::${kind}{src="${src}"${v.caption ? ` caption="${attr(v.caption)}"` : ""}}`);
          return null;
        },
      }),
  },
  { id: "details", label: "Collapsible details", keywords: "accordion toggle", run: (e) => insertShortcode(e, ':::details{summary="More"}\nHidden text.\n:::') },
  { id: "toc", label: "Table of contents", keywords: "contents toc", run: (e) => insertShortcode(e, "::toc") },
];

function filterBlocks(q: string) {
  const s = q.trim().toLowerCase();
  return s ? BLOCKS.filter((b) => `${b.label} ${b.keywords}`.toLowerCase().includes(s)) : BLOCKS;
}

/* ---------------------------------------------------------------------------------------------
 * Toolbar
 * ------------------------------------------------------------------------------------------- */

function Tool({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-9 min-w-9 shrink-0 rounded-md px-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
        active ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

const LANGUAGES = ["", "bash", "shell", "ts", "tsx", "js", "jsx", "json", "yaml", "python", "go", "java", "rust", "sql", "dockerfile", "hcl", "toml", "html", "css", "diff", "text"];
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-slate-200 dark:bg-white/10" aria-hidden="true" />;

function Toolbar({ editor, onInsert, onLink, onImageAlt }: { editor: Editor; onInsert: () => void; onLink: () => void; onImageAlt: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      level: ([2, 3, 4, 5, 6] as const).find((l) => e.isActive("heading", { level: l })) ?? 0,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      language: (e.getAttributes("codeBlock").language as string | null) ?? "",
      image: e.isActive("image"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]">
      <Tool label="Insert block (or type / )" onClick={onInsert}>＋</Tool>
      <select
        aria-label="Block type"
        className="h-9 shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-white/15 dark:bg-surface-dark"
        value={s.level}
        onChange={(e) => {
          const l = Number(e.target.value);
          if (l) c().setHeading({ level: l as 2 }).run();
          else c().setParagraph().run();
        }}
      >
        <option value={0}>Paragraph</option>
        {[2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>Heading {l}</option>)}
      </select>
      <Sep />
      <Tool label="Bold (Ctrl/⌘ B)" active={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></Tool>
      <Tool label="Italic (Ctrl/⌘ I)" active={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></Tool>
      <Tool label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></Tool>
      <Tool label="Inline code (Ctrl/⌘ E)" active={s.code} onClick={() => c().toggleCode().run()}>{"</>"}</Tool>
      <Tool label="Link (Ctrl/⌘ K)" active={s.link} onClick={onLink}>🔗</Tool>
      <Sep />
      <Tool label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>•</Tool>
      <Tool label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>1.</Tool>
      <Tool label="Task list" active={s.task} onClick={() => c().toggleTaskList().run()}>☑</Tool>
      <Tool label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}>❝</Tool>
      <Tool label="Code block" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}>{"{ }"}</Tool>
      {s.codeBlock && (
        <select aria-label="Code language" className="h-9 shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-white/15 dark:bg-surface-dark"
          value={s.language} onChange={(e) => c().updateAttributes("codeBlock", { language: e.target.value || null }).run()}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l || "Language…"}</option>)}
        </select>
      )}
      {s.image && <Tool label="Image alt text" onClick={onImageAlt}>Alt</Tool>}
      <Sep />
      <Tool label="Move block up (Alt Shift ↑)" onClick={() => moveBlock(editor, -1)}>↑</Tool>
      <Tool label="Move block down (Alt Shift ↓)" onClick={() => moveBlock(editor, 1)}>↓</Tool>
      <Tool label="Duplicate block (Ctrl/⌘ Shift D)" onClick={() => duplicateBlock(editor)}>⧉</Tool>
      <Tool label="Delete block (Alt Shift Backspace)" onClick={() => deleteBlock(editor)}>🗑</Tool>
      <Sep />
      <Tool label="Undo (Ctrl/⌘ Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>↶</Tool>
      <Tool label="Redo (Ctrl/⌘ Shift Z)" disabled={!s.canRedo} onClick={() => c().redo().run()}>↷</Tool>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The editor
 * ------------------------------------------------------------------------------------------- */

export function wordCount(md: string) {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`[\]()!-]/g, " ").split(/\s+/).filter(Boolean).length;
}

type Mode = "visual" | "source";

/**
 * Visual block editor over Markdown (the stored format). Opens in source mode when the visual editor
 * could not represent the document exactly (see lib/editor/markdown.ts), and asks before switching.
 */
export function BlockEditor({
  value,
  onChange,
  mediaContext,
  placeholder = "Type / for blocks, or start writing…",
}: {
  value: string;
  onChange: (markdown: string) => void;
  mediaContext: string;
  placeholder?: string;
}) {
  const check = useMemo(() => fidelity(value), []); // eslint-disable-line react-hooks/exhaustive-deps -- checked once, on open
  const [mode, setMode] = useState<Mode>(check.lossless ? "visual" : "source");
  const [picker, setPicker] = useState(false);
  const [imageDialog, setImageDialog] = useState<{ src: string; alt: string; width: number; height: number } | null>(null);
  const [ask, setAsk] = useState<(AskRequest & { values: Record<string, string>; error?: string }) | null>(null);
  const [slash, setSlash] = useState<{ query: string; index: number; from: number } | null>(null);
  const [inserter, setInserter] = useState(false);
  const latest = useRef(value);
  const slashRef = useRef(slash);
  useEffect(() => {
    slashRef.current = slash;
  }, [slash]);

  const ui: InserterUi = { pickImage: () => setPicker(true), ask: (q) => setAsk({ ...q, values: {} }) };
  const uiRef = useRef(ui);
  useEffect(() => {
    uiRef.current = ui;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...editorExtensions().filter((x) => x.name !== "protectedBlock"),
      ProtectedBlockView,
      Markdown,
      BlockKeys,
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: check.lossless ? value : "",
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "prose prose-slate max-w-none min-h-[420px] px-4 py-4 sm:px-6 sm:py-5 focus:outline-none dark:prose-invert",
        "aria-label": "Post content",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, event) => {
        const s = slashRef.current;
        if (!s) return false;
        const items = filterBlocks(s.query);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          setSlash({ ...s, index: (s.index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1) });
          return true;
        }
        if (event.key === "Enter" && items[s.index]) {
          runSlash(items[s.index]!);
          return true;
        }
        if (event.key === "Escape") {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      latest.current = md;
      onChange(md);
      // Slash commands: "/query" alone in a paragraph, with the cursor at its end.
      const { $from, empty } = e.state.selection;
      const text = $from.parent.type.name === "paragraph" ? $from.parent.textContent : "";
      if (empty && /^\/[\w ]{0,20}$/.test(text) && $from.parentOffset === text.length) setSlash((p) => ({ query: text.slice(1), index: p?.query === text.slice(1) ? p.index : 0, from: $from.start() }));
      else if (slashRef.current) setSlash(null);
    },
  });

  function runSlash(block: BlockDef) {
    if (!editor) return;
    const s = slashRef.current;
    if (s) editor.chain().focus().deleteRange({ from: s.from, to: editor.state.selection.from }).run();
    setSlash(null);
    block.run(editor, uiRef.current);
  }

  function switchTo(next: Mode) {
    if (next === mode || !editor) return;
    if (next === "visual") {
      const f = fidelity(latest.current);
      if (!f.lossless && !window.confirm(`The visual editor would change this content (${f.firstDifference}). Formatting it cannot represent may be rewritten. Switch anyway?`)) return;
      editor.commands.setContent(latest.current, { contentType: "markdown" });
    }
    setMode(next);
  }

  function setLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL (https://…, mailto: or /path). Empty removes the link.", previous ?? "https://");
    if (href === null) return;
    if (href.trim() === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else if (!isSafeUrl(href)) window.alert("Only https://, http://, mailto: and site paths (/…) are allowed.");
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  function setImageAlt() {
    if (!editor) return;
    const alt = window.prompt("Alt text (describe the image for screen readers):", (editor.getAttributes("image").alt as string) ?? "");
    if (alt !== null) editor.chain().focus().updateAttributes("image", { alt: alt.trim() }).run();
  }

  function insertImage(img: { src: string; alt: string; caption: string; align: string; size: string }) {
    if (!editor) return;
    const md = `![${img.alt.replace(/[\][\n]/g, "")}](${img.src})`;
    if (mode === "source") {
      const next = `${latest.current.trimEnd()}\n\n${img.caption || img.align !== "center" || img.size !== "large" ? `:::figure{caption="${attr(img.caption)}" align="${img.align}" size="${img.size}"}\n${md}\n:::` : md}\n`;
      latest.current = next;
      onChange(next);
    } else if (img.caption || img.align !== "center" || img.size !== "large") {
      insertShortcode(editor, `:::figure{caption="${attr(img.caption)}" align="${img.align}" size="${img.size}"}\n${md}\n:::`);
    } else {
      editor.chain().focus().setImage({ src: img.src, alt: img.alt }).run();
    }
  }

  const words = wordCount(value);
  const items = slash ? filterBlocks(slash.query) : [];

  return (
    <div>
      {!check.lossless && mode === "source" && (
        <div className="mb-3">
          <Alert tone="info">
            This content uses formatting the visual editor cannot represent exactly ({check.firstDifference}), so it is open in source mode to keep it intact.
          </Alert>
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-surface-dark-raised">
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-t-2xl border-b border-slate-200 bg-white/95 px-2 py-1.5 backdrop-blur dark:border-white/10 dark:bg-surface-dark-raised/95">
          <div role="tablist" aria-label="Editing mode" className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-white/5">
            {(["visual", "source"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchTo(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? "bg-white text-ink shadow-sm dark:bg-surface-dark-raised dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>
                {m === "visual" ? "Visual" : "Markdown"}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {mode === "visual" && editor && <Toolbar editor={editor} onInsert={() => setInserter(true)} onLink={setLink} onImageAlt={setImageAlt} />}
            {mode === "source" && (
              <div className="flex gap-1">
                <Tool label="Insert image" onClick={() => setPicker(true)}>🖼</Tool>
              </div>
            )}
          </div>
        </div>

        {mode === "visual" && editor && (
          <div className="relative">
            <BubbleMenu editor={editor} shouldShow={({ editor: e, state }) => !state.selection.empty && !e.isActive("protectedBlock") && !e.isActive("image")}
              className="flex gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-surface-dark-raised">
              <Tool label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Tool>
              <Tool label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Tool>
              <Tool label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Tool>
              <Tool label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</Tool>
              <Tool label="Link" active={editor.isActive("link")} onClick={setLink}>🔗</Tool>
            </BubbleMenu>
            <EditorContent editor={editor} />
            {slash && (
              <div role="listbox" aria-label="Insert block" className="absolute left-4 right-4 z-20 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl sm:right-auto sm:w-80 dark:border-white/10 dark:bg-surface-dark-raised"
                style={{ top: Math.max(8, (editor.view.coordsAtPos(editor.state.selection.from).bottom - (editor.view.dom.getBoundingClientRect().top ?? 0)) + 8) }}>
                {items.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">No matching blocks</p>
                ) : (
                  items.map((b, i) => (
                    <button key={b.id} type="button" role="option" aria-selected={i === slash.index} onMouseDown={(e) => e.preventDefault()} onClick={() => runSlash(b)}
                      className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${i === slash.index ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                      {b.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        {mode === "source" && (
          <textarea value={value} onChange={(e) => { latest.current = e.target.value; onChange(e.target.value); }} spellCheck aria-label="Markdown source"
            className="block min-h-[420px] w-full resize-y bg-transparent px-4 py-4 font-mono text-sm leading-6 text-ink focus:outline-none sm:px-6 sm:py-5 dark:text-slate-100" />
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
          <span>{words} words · about {Math.max(1, Math.round(words / 220))} min read</span>
          <span className="hidden sm:inline">Type / for blocks · Alt Shift ↑/↓ moves a block</span>
        </div>
      </div>

      {/* Searchable block inserter */}
      <InserterDialog open={inserter} onClose={() => setInserter(false)} onPick={(b) => { setInserter(false); if (editor) b.run(editor, ui); }} />

      {/* Image: pick from the library (upload, paste or drop there), then alt text, caption and layout */}
      <MediaPicker open={picker} onClose={() => setPicker(false)} context={mediaContext} title="Insert an image"
        onSelect={(item) => { setPicker(false); setImageDialog({ src: item.src, alt: item.alt, width: item.width, height: item.height }); }} />
      {imageDialog && <ImageDialog image={imageDialog} onClose={() => setImageDialog(null)} onInsert={(img) => { insertImage(img); setImageDialog(null); }} />}

      {ask && (
        <Dialog open onClose={() => setAsk(null)} title={ask.title} size="md"
          footer={<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
            <Button type="button" onClick={() => { const error = ask.submit(ask.values); if (error) setAsk({ ...ask, error }); else setAsk(null); }}>Insert</Button></div>}>
          <div className="space-y-4">
            {ask.error && <Alert>{ask.error}</Alert>}
            {ask.fields.map((f, i) => (
              <Field key={f.name} label={f.label} htmlFor={`ask-${f.name}`} hint={f.hint}>
                {f.name === "text" ? (
                  <Textarea id={`ask-${f.name}`} rows={4} value={ask.values[f.name] ?? ""} onChange={(e) => setAsk({ ...ask, values: { ...ask.values, [f.name]: e.target.value } })} {...(i === 0 ? { "data-autofocus": true } : {})} />
                ) : (
                  <Input id={`ask-${f.name}`} value={ask.values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setAsk({ ...ask, values: { ...ask.values, [f.name]: e.target.value } })} {...(i === 0 ? { "data-autofocus": true } : {})} />
                )}
              </Field>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InserterDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (b: BlockDef) => void }) {
  const [q, setQ] = useState("");
  const list = filterBlocks(q);
  return (
    <Dialog open={open} onClose={onClose} title="Insert a block" size="md">
      <Field label="Search blocks" htmlFor="block-search">
        <Input id="block-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="heading, image, callout…" data-autofocus
          onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { e.preventDefault(); onPick(list[0]); } }} />
      </Field>
      <ul className="mt-4 grid gap-1 sm:grid-cols-2">
        {list.map((b) => (
          <li key={b.id}>
            <button type="button" onClick={() => onPick(b)} className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-brand-400 hover:bg-brand-50 dark:border-white/10 dark:hover:bg-white/5">
              {b.label}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ImageDialog({ image, onClose, onInsert }: { image: { src: string; alt: string; width: number; height: number }; onClose: () => void; onInsert: (v: { src: string; alt: string; caption: string; align: string; size: string }) => void }) {
  const [alt, setAlt] = useState(image.alt);
  const [caption, setCaption] = useState("");
  const [align, setAlign] = useState("center");
  const [size, setSize] = useState("large");
  return (
    <Dialog open onClose={onClose} title="Image details" size="md"
      footer={<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="button" disabled={!alt.trim()} onClick={() => onInsert({ src: image.src, alt: alt.trim(), caption: caption.trim(), align, size })}>Insert</Button></div>}>
      <div className="space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- editor preview */}
        <img src={image.src} alt="" width={image.width || undefined} height={image.height || undefined} className={`mx-auto h-auto rounded-lg border border-slate-200 dark:border-white/10 ${size === "small" ? "max-w-[40%]" : size === "medium" ? "max-w-[70%]" : "w-full"}`} />
        <Field label="Alt text" htmlFor="img-alt" hint="Required. Describe what the image shows."><Input id="img-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} data-autofocus /></Field>
        <Field label="Caption (optional)" htmlFor="img-caption"><Input id="img-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Alignment" htmlFor="img-align" hint="Wide extends past the text on large screens."><Select id="img-align" value={align} onChange={(e) => setAlign(e.target.value)}><option value="center">Centered</option><option value="wide">Wide</option><option value="full">Full column</option></Select></Field>
          <Field label="Size" htmlFor="img-size"><Select id="img-size" value={size} onChange={(e) => setSize(e.target.value)}><option value="large">Large</option><option value="medium">Medium</option><option value="small">Small</option></Select></Field>
        </div>
      </div>
    </Dialog>
  );
}
