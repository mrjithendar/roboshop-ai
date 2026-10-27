import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo/sitemap";

export const revalidate = 300;

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}
