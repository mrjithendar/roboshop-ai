import type { ComponentProps } from "react";
import { resolveMedia } from "@/lib/media";
import { MediaUnavailable } from "./ContentImage";

/** ::video shortcode: only published uploads; sized by its .media-frame wrapper (no layout shift). */
export async function ContentVideo({ src, poster, children: _children, ...props }: ComponentProps<"video">) {
  void _children;
  const media = typeof src === "string" ? await resolveMedia(src) : undefined;
  if (media?.kind !== "videos") return <MediaUnavailable kind="Video" />;
  const still = typeof poster === "string" ? await resolveMedia(poster) : undefined;
  return (
    <video {...props} src={media.src} poster={still?.kind === "images" ? still.src : undefined} controls preload="metadata" playsInline>
      <a href={media.src}>Download the video</a>
    </video>
  );
}

/** ::audio shortcode: full-width native player; nothing is downloaded until play. */
export async function ContentAudio({ src, children: _children, ...props }: ComponentProps<"audio">) {
  void _children;
  const media = typeof src === "string" ? await resolveMedia(src) : undefined;
  if (media?.kind !== "audio") return <MediaUnavailable kind="Audio" />;
  return (
    <audio {...props} src={media.src} controls preload="none" className="w-full">
      <a href={media.src}>Download the audio</a>
    </audio>
  );
}
