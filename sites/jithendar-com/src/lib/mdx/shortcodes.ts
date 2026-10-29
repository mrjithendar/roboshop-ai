import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

/**
 * Shortcodes via Markdown directives (remark-directive). Only these names and attributes are honoured;
 * anything else renders as its plain text. Nothing is executed.
 *
 *   :::callout{type="info|tip|warning|danger" title="…"}  …  :::
 *   ::button[Label]{href="/path or https://…"}
 *   :::figure{caption="…" align="center|wide|full" size="small|medium|large"}  ![alt](/media/…)  :::
 *   :::gallery{caption="…"}  ![a](/media/…) ![b](/media/…)  :::   (a responsive grid)
 *   :::details{summary="…"}  …  :::
 *   ::toc
 *   ::video{src="/media/<id>/clip.mp4" poster="/media/<id>/still.jpg" caption="…" ratio="16:9|4:3|1:1|9:16"}
 *   ::audio{src="/media/<id>/episode.mp3" caption="…"}
 *   ::embed{src="https://www.youtube.com/watch?v=…" title="…"}   (YouTube or Vimeo only)
 *
 * Video and audio must be uploads served from /media/. Embeds use the providers' privacy modes
 * (youtube-nocookie.com, Vimeo dnt=1), load lazily and are sandboxed.
 */
const CALLOUT_TYPES = new Set(["info", "tip", "warning", "danger"]);

type DirectiveNode = {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children: unknown[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
};

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return /^https:\/\/[^\s]+$/i.test(href) ? href : null;
}

const text = (value: string) => ({ type: "text", value });

const MEDIA_SRC = /^\/media\/[0-9a-f-]{36}\/[a-z0-9-]+\.[a-z0-9]{2,5}$/;
const RATIOS: Record<string, string> = { "16:9": "ratio-16-9", "4:3": "ratio-4-3", "1:1": "ratio-1-1", "9:16": "ratio-9-16" };

/** YouTube/Vimeo page or embed URL → privacy-mode embed URL; anything else → null. */
export function embedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const id = (v: string | null | undefined) => (v && /^[A-Za-z0-9_-]{6,20}$/.test(v) ? v : null);
  let yt: string | null = null;
  if (host === "youtu.be") yt = id(u.pathname.slice(1));
  else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    yt = u.pathname === "/watch" ? id(u.searchParams.get("v")) : id(/^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1]);
  }
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}`;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = /^\/(?:video\/)?(\d{4,12})$/.exec(u.pathname)?.[1];
    if (v) return `https://player.vimeo.com/video/${v}?dnt=1`;
  }
  return null;
}

/** Wrap a media element in a figure with an optional caption. */
function figure(n: DirectiveNode, media: Record<string, unknown>, caption: string | null | undefined) {
  const data = (n.data ??= {});
  data.hName = "figure";
  data.hProperties = { className: ["media-figure"] };
  data.hChildren = [media, ...(caption ? [{ type: "element", tagName: "figcaption", properties: {}, children: [text(caption)] }] : [])];
}

export function remarkShortcodes() {
  return (tree: Root) => {
    visit(tree, (node) => {
      const n = node as unknown as DirectiveNode;
      if (n.type !== "containerDirective" && n.type !== "leafDirective" && n.type !== "textDirective") return;
      const attrs = n.attributes ?? {};
      const data = (n.data ??= {});

      if (n.name === "callout" && n.type === "containerDirective") {
        const kind = CALLOUT_TYPES.has(attrs.type ?? "") ? attrs.type! : "info";
        data.hName = "aside";
        data.hProperties = { className: ["callout", `callout-${kind}`], role: kind === "warning" || kind === "danger" ? "note" : undefined };
        if (attrs.title) n.children.unshift({ type: "paragraph", data: { hProperties: { className: ["callout-title"] } }, children: [text(attrs.title)] });
        return;
      }
      if (n.name === "button" && n.type !== "containerDirective") {
        const href = safeHref(attrs.href);
        if (!href) return;
        data.hName = "a";
        data.hProperties = { href, className: ["shortcode-button"], ...(href.startsWith("https://") ? { rel: "noopener" } : {}) };
        return;
      }
      if ((n.name === "figure" || n.name === "gallery") && n.type === "containerDirective") {
        data.hName = "figure";
        const align = ["center", "wide", "full"].includes(attrs.align ?? "") ? attrs.align! : "center";
        const size = ["small", "medium", "large"].includes(attrs.size ?? "") ? attrs.size! : "large";
        data.hProperties = { className: n.name === "gallery" ? ["shortcode-gallery", `align-${align}`] : ["shortcode-figure", `align-${align}`, `size-${size}`] };
        if (attrs.caption) n.children.push({ type: "paragraph", data: { hName: "figcaption" }, children: [text(attrs.caption)] });
        return;
      }
      if (n.name === "details" && n.type === "containerDirective") {
        data.hName = "details";
        data.hProperties = { className: ["shortcode-details"] };
        n.children.unshift({ type: "paragraph", data: { hName: "summary" }, children: [text(attrs.summary || "Details")] });
        return;
      }
      if ((n.name === "video" || n.name === "audio") && n.type === "leafDirective" && MEDIA_SRC.test(attrs.src ?? "")) {
        const fallback = { type: "element", tagName: "a", properties: { href: attrs.src }, children: [text(`Download the ${n.name}`)] };
        if (n.name === "video") {
          const poster = attrs.poster && MEDIA_SRC.test(attrs.poster) ? attrs.poster : undefined;
          const frame = {
            type: "element",
            tagName: "div",
            properties: { className: ["media-frame", RATIOS[attrs.ratio ?? ""] ?? "ratio-16-9"] },
            children: [{ type: "element", tagName: "video", properties: { src: attrs.src, poster, controls: true, preload: "metadata", playsInline: true }, children: [fallback] }],
          };
          figure(n, frame, attrs.caption);
        } else {
          figure(n, { type: "element", tagName: "audio", properties: { src: attrs.src, controls: true, preload: "none" }, children: [fallback] }, attrs.caption);
        }
        return;
      }
      if (n.name === "embed" && n.type === "leafDirective") {
        const src = embedUrl(attrs.src);
        if (src) {
          const title = (attrs.title || "Embedded video").slice(0, 200);
          const frame = {
            type: "element",
            tagName: "div",
            properties: { className: ["media-frame", "ratio-16-9"] },
            children: [
              {
                type: "element",
                tagName: "iframe",
                properties: {
                  src,
                  title,
                  loading: "lazy",
                  allow: "encrypted-media; picture-in-picture; fullscreen",
                  allowFullScreen: true,
                  referrerPolicy: "strict-origin-when-cross-origin",
                  sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups",
                },
                children: [],
              },
            ],
          };
          figure(n, frame, attrs.caption);
          return;
        }
      }
      if (n.name === "toc" && n.type === "leafDirective") {
        data.hName = "nav";
        data.hProperties = { "data-shortcode": "toc" };
        return;
      }
      // Unknown or misplaced shortcode: show its text content, never render it as markup.
      data.hName = n.type === "textDirective" ? "span" : "p";
      data.hChildren = [{ type: "text", value: toString(n as never) }];
    });
  };
}
