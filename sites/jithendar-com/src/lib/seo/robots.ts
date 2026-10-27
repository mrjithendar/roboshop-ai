import { absoluteUrl } from "@/config/site";

export function robotsTxt(indexable: boolean): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    `Sitemap: ${absoluteUrl("/news-sitemap.xml")}`,
    "",
  ].join("\n");
}
