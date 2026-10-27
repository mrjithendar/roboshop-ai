import { site } from "@/config/site";
import { ogCard, ogSize } from "@/lib/og/card";

export const alt = `${site.name}: engineering insight on AI, cloud and Kubernetes`;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Independent engineering publication",
    title: "Engineering insight for teams building with AI, cloud and Kubernetes",
    footer: "AI engineering · Cloud · Kubernetes · Platform engineering · Security",
  });
}
