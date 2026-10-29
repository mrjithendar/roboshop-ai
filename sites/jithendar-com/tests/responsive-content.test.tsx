import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { embedUrl } from "@/lib/mdx/shortcodes";
import { markdownToHtml } from "@/lib/mdx/html";

vi.mock("server-only", () => ({}));

const VIDEO = "/media/0f8fad5b-d9cb-469f-a165-70867728950e/demo.mp4";

describe("responsive article content", () => {
  it("wraps wide tables in their own keyboard-scrollable region", async () => {
    const html = await markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toMatch(/<div class="table-scroll" tabindex="0" role="region" aria-label="Table \(scrolls sideways\)"><table>/);
  });

  it("renders ::video and ::audio from uploads only, in fixed-ratio frames with fallbacks", async () => {
    const html = await markdownToHtml(`::video{src="${VIDEO}" ratio="9:16" caption="Demo"}\n\n::audio{src="${VIDEO.replace("mp4", "mp3")}"}\n\n::video{src="https://evil.example/x.mp4"}`);
    expect(html).toContain('<figure class="media-figure"><div class="media-frame ratio-9-16"><video src="' + VIDEO + '" controls preload="metadata" playsinline>');
    expect(html).toContain("<figcaption>Demo</figcaption>");
    expect(html).toContain('<audio src="/media/0f8fad5b-d9cb-469f-a165-70867728950e/demo.mp3" controls preload="none">');
    expect(html).not.toContain("evil.example/x.mp4\"");
  });

  it("embeds only YouTube/Vimeo, in privacy mode, lazily and sandboxed", async () => {
    expect(embedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(embedUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(embedUrl("https://evil.example/embed/x")).toBeNull();
    expect(embedUrl("javascript:alert(1)")).toBeNull();
    const html = await markdownToHtml('::embed{src="https://youtu.be/dQw4w9WgXcQ" title="Talk"}');
    expect(html).toMatch(/<div class="media-frame ratio-16-9"><iframe src="https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ" title="Talk" loading="lazy"/);
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
  });

  it("shows the description when an image cannot be loaded, instead of a broken frame", async () => {
    const { ContentImage } = await import("@/components/ContentImage");
    const html = renderToStaticMarkup(await ContentImage({ src: "https://tracker.example/pixel.png", alt: "Cluster diagram" }));
    expect(html).toContain('role="img"');
    expect(html).toContain("Image unavailable: Cluster diagram");
    expect(html).not.toContain("tracker.example");
  });
});
