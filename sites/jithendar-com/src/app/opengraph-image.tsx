import { ImageResponse } from "next/og";
import { ogCard, ogSize } from "@/lib/og/card";
import { getPublishedConfig } from "@/lib/site-config/store";
import { ownImageBytes } from "@/lib/site-config/image-bytes";

export const alt = "Jithendar.com";
export const size = ogSize;
export const contentType = "image/png";
// Reflects the published configuration (Admin → Appearance → Branding / General).
export const dynamic = "force-dynamic";

/**
 * Default share image for pages without their own: the configured social image (PNG or JPEG, read from our
 * media; nothing is fetched), otherwise a generated card with the site name and tagline.
 */
export default async function Image() {
  const { config } = await getPublishedConfig();
  const img = config.branding.socialImage;
  if (img) {
    const file = await ownImageBytes(img.src);
    if (file && (file.contentType === "image/png" || file.contentType === "image/jpeg")) {
      const dataUrl = `data:${file.contentType};base64,${file.bytes.toString("base64")}`;
      return new ImageResponse(
        <img src={dataUrl} alt="" width={ogSize.width} height={ogSize.height} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${img.focalX}% ${img.focalY}%` }} />,
        ogSize,
      );
    }
  }
  return ogCard({
    eyebrow: config.general.tagline || "Independent engineering publication",
    title: config.seo.homeTitle,
    footer: "AI engineering · Cloud · Kubernetes · Platform engineering · Security",
    accent: config.theme.light.accent,
    name: config.general.siteName,
  });
}
